const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit')

// Load environment variables
dotenv.config();

const app = express();

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://yourdomain.com']
  : ['http://127.0.0.1:8080','http://127.0.0.1:3000'];

// Middleware
app.use(cors({
    origin: allowedOrigins,
    credentials: true
  }));
app.use(express.json());
app.use(helmet({
  frameguard: { action: 'deny' }
}));


const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
  });
  app.use(limiter);

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'noble_capital',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Create users table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                balance DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create transactions table with admin notification fields
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                type ENUM('deposit', 'withdrawal') NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                method VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL,
                transaction_id VARCHAR(36) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                mpesa_checkout_request_id VARCHAR(255),
                mpesa_receipt_number VARCHAR(255),
                failure_reason TEXT,
                admin_notified BOOLEAN DEFAULT FALSE,
                phone_number VARCHAR(15),
                admin_notes TEXT
            )
        `);

        // Create earnings_activations table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS earnings_activations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                date_activated DATE NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Create investments table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS investments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                daily_return DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        connection.release();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}
// Initialize database on startup
initializeDatabase();

// Middleware for authentication
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Authentication Routes
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Check if user already exists
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const [result] = await pool.execute(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name]
        );

        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error: error.message });
    }
});

app.post('/api/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        console.log(token)
        res.json({
            token,
            user: {
                email: user.email,
                name: user.name,
                balance: user.balance
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error signing in', error: error.message });
    }
});

// M-Pesa Configuration
const MPESA_BASE_URL = process.env.MPESA_ENVIRONMENT === 'production' 
    ? 'https://api.safaricom.co.ke' 
    : 'https://sandbox.safaricom.co.ke';


async function getMpesaAccessToken() {
    const auth = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    try {
        const response = await axios.get(
            `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            }
        );
        return response.data.access_token;
    } catch (error) {
        throw new Error('Failed to get M-Pesa access token');
    }
}


function generateMpesaPassword() {
    const timestamp = moment().format('YYYYMMDDHHmmss');
    const password = Buffer.from(
        `${process.env.MPESA_BUSINESS_SHORT_CODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');
    return { password, timestamp };
}


app.post('/api/payment/mpesa', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { amount, phoneNumber } = req.body;
        const userId = req.user.userId;

        
        if (amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        
        if (!phoneNumber || !/^254\d{9}$/.test(phoneNumber)) {
            return res.status(400).json({ 
                message: 'Invalid phone number. Use format 254XXXXXXXXX' 
            });
        }

        
        const accessToken = await getMpesaAccessToken();
        const { password, timestamp } = generateMpesaPassword();
        const transactionId = uuidv4();

        
        const stkPushPayload = {
            BusinessShortCode: process.env.MPESA_BUSINESS_SHORT_CODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: process.env.MPESA_BUSINESS_SHORT_CODE,
            PhoneNumber: phoneNumber,
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: `ACC${userId}`,
            TransactionDesc: `Payment for account ${userId}`
        };


        const stkResponse = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            stkPushPayload,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (stkResponse.data.ResponseCode === '0') {
            await connection.execute(
                'INSERT INTO transactions (user_id, type, amount, method, status, transaction_id, mpesa_checkout_request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, 'deposit', amount, 'mpesa', 'pending', transactionId, stkResponse.data.CheckoutRequestID]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'STK Push sent successfully',
                checkoutRequestId: stkResponse.data.CheckoutRequestID,
                transactionId
            });
        } else {
            throw new Error(stkResponse.data.ResponseDescription || 'STK Push failed');
        }

    } catch (error) {
        await connection.rollback();
        console.error('M-Pesa payment error:', error);
        res.status(500).json({ 
            success: false,
            message: error.message || 'Payment processing failed' 
        });
    } finally {
        connection.release();
    }
});

// Set a timeout for database operations
// const timeoutPromise = new Promise((_, reject) => {
//     setTimeout(() => reject(new Error('Callback timeout')), 25000);
// });

app.post('/api/payment/mpesa/callback', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { Body } = req.body;
        const { stkCallback } = Body;
        const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

        console.log('M-Pesa Callback:', JSON.stringify(req.body, null, 2));

        // Find the transaction
        const [transactions] = await connection.execute(
            'SELECT * FROM transactions WHERE mpesa_checkout_request_id = ?',
            [CheckoutRequestID]
        );

        if (transactions.length === 0) {
            console.error('Transaction not found for CheckoutRequestID:', CheckoutRequestID);
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const transaction = transactions[0];

        if (ResultCode === 0) {
            // Payment successful
            const { CallbackMetadata } = stkCallback;
            const metadata = {};
            
            CallbackMetadata.Item.forEach(item => {
                metadata[item.Name] = item.Value;
            });

            // Update transaction status
            await connection.execute(
                'UPDATE transactions SET status = ?, mpesa_receipt_number = ? WHERE id = ?',
                ['completed', metadata.MpesaReceiptNumber || '', transaction.id]
            );

            // Update user balance
            await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [transaction.amount, transaction.user_id]
            );

            console.log('Payment completed successfully:', CheckoutRequestID);
        } else {
            // Payment failed
            await connection.execute(
                'UPDATE transactions SET status = ?, failure_reason = ? WHERE id = ?',
                ['failed', ResultDesc, transaction.id]
            );

            console.log('Payment failed:', CheckoutRequestID, ResultDesc);
        }

        await connection.commit();
        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    } catch (error) {
        await connection.rollback();
        console.error('Callback processing error:', error);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Failed' });
    } finally {
        connection.release();
    }
});

// Check Payment Status
app.get('/api/payment/mpesa/status/:transactionId', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.userId;

        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE transaction_id = ? AND user_id = ?',
            [transactionId, userId]
        );

        if (transactions.length === 0) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const transaction = transactions[0];
        res.json({
            transactionId: transaction.transaction_id,
            status: transaction.status,
            amount: transaction.amount,
            method: transaction.method,
            createdAt: transaction.created_at,
            mpesaReceiptNumber: transaction.mpesa_receipt_number
        });

    } catch (error) {
        res.status(500).json({ message: 'Error checking payment status', error: error.message });
    }
});

// User Routes
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.execute(
            'SELECT id, email, name, balance, created_at FROM users WHERE id = ?',
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(users[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user profile', error: error.message });
    }
});

app.get('/api/user/transactions', authenticateToken, async (req, res) => {
    try {
        const [transactions] = await pool.execute(
            'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.userId]
        );

        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching transactions', error: error.message });
    }
});

// Example portfolios data
const portfolios = [
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 2,
    name: "Zoox Autonomous Vehicle",
    price: 1500,
    image: "https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.67
  },
  {
    id: 2,
    name: "BMw i5 Hydrogen",
    price: 104500,
    image: "https://noblecapitalltd.com/uploads/products/kmrBW9vUQTO5Xo3coj2Vcc83xJJFsswAS1CAsAK0.jpg",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Xpeng Mona M03",
    price: 'KES 19500',
    image: "https://noblecapitalltd.com/uploads/products/aff7NMnlifIQ1AC7FokTdESuANPID9KiXMPgLlks.jpg",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  {
    id: 1,
    name: "Google Waymo",
    price: 700,
    image: "https://images.unsplash.com/photo-1511918984145-48de785d4c4e?auto=format&fit=crop&w=400&q=80",
    returnRate: 31.43
  },
  // ...add more as needed
];

app.get('/api/portfolios', (req, res) => {
  res.json(portfolios);
});

app.post('/api/activate-earnings', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Check if user already activated earnings today
        const [activations] = await connection.execute(
            'SELECT * FROM earnings_activations WHERE user_id = ? AND date_activated = ?',
            [userId, today]
        );
        if (activations.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Earnings already activated today.' });
        }

        // 2. Calculate total daily earnings from investments
        const [investments] = await connection.execute(
            'SELECT SUM(daily_return) AS total_earnings FROM investments WHERE user_id = ?',
            [userId]
        );
        const totalEarnings = investments[0].total_earnings || 0;

        if (totalEarnings <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'No active investments for earnings.' });
        }

        // 3. Update user balance
        await connection.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [totalEarnings, userId]
        );

        // 4. Record the activation
        await connection.execute(
            'INSERT INTO earnings_activations (user_id, date_activated, amount) VALUES (?, ?, ?)',
            [userId, today, totalEarnings]
        );

        await connection.commit();
        res.json({ success: true, message: 'Earnings activated successfully!', amount: totalEarnings });
    } catch (error) {
        await connection.rollback();
        console.error('Activate earnings error:', error);
        res.status(500).json({ success: false, message: 'Failed to activate earnings.' });
    } finally {
        connection.release();
    }
});

app.post('/api/withdraw/mpesa', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { amount, phoneNumber } = req.body;
        const userId = req.user.userId;

        // Validate amount
        if (amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        // Validate phone number
        if (!phoneNumber || !/^254\d{9}$/.test(phoneNumber)) {
            return res.status(400).json({ 
                message: 'Invalid phone number. Use format 254XXXXXXXXX' 
            });
        }

        // Check if user has enough balance
        const [users] = await connection.execute(
            'SELECT balance, name, email FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'User not found' });
        }

        const user = users[0];
        const userBalance = parseFloat(user.balance);
        
        if (userBalance < parseFloat(amount)) {
            await connection.rollback();
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        const transactionId = uuidv4();
        
        // Record the withdrawal request
        await connection.execute(
            'INSERT INTO transactions (user_id, type, amount, method, status, transaction_id, phone_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, 'withdrawal', amount, 'mpesa', 'pending', transactionId, phoneNumber]
        );

        // Get the inserted transaction ID
        const [insertResult] = await connection.execute(
            'SELECT LAST_INSERT_ID() as id'
        );
        const transactionDbId = insertResult[0].id;

        // Update user balance (reserve the funds)
        await connection.execute(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [amount, userId]
        );

        // Send email to admin
        const emailSubject = 'New Withdrawal Request';
        const emailBody = `
            New withdrawal request details:
            
            Transaction ID: ${transactionId}
            User: ${user.name} (${user.email})
            Amount: KES ${amount}
            Phone Number: ${phoneNumber}
            Date: ${new Date().toLocaleString()}
            
            Please process this request manually and update the transaction status in the admin dashboard.
        `;
        
        try {
            await sendAdminEmail(emailSubject, emailBody);
            
            await connection.execute(
                'UPDATE transactions SET admin_notified = TRUE WHERE id = ?',
                [transactionDbId]
            );
        } catch (emailError) {
            console.error('Failed to send admin email notification:', emailError);
            // Continue despite email failure
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Withdrawal request submitted. Our admin will process it shortly.',
            transactionId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Withdrawal request error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Withdrawal request failed: ' + error.message
        });
    } finally {
        connection.release();
    }
});

// Configure email transporter
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail', // e.g., 'gmail', 'outlook', etc.
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Function to send email to admin
async function sendAdminEmail(subject, message) {
    const adminEmail = process.env.ADMIN_EMAIL;
    
    if (!adminEmail) {
        console.warn('Admin email not configured in environment variables');
        return;
    }
    
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: adminEmail,
            subject: subject,
            text: message
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ', info.response);
        return true;
    } catch (error) {
        console.error('Email sending error:', error);
        throw error;
    }
}

// Function to send email to user
async function sendUserEmail(userEmail, subject, message) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: userEmail,
            subject: subject,
            text: message
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent to user: ', info.response);
        return true;
    } catch (error) {
        console.error('Email sending error:', error);
        throw error;
    }
}

// Add admin endpoints to process withdrawals
app.post('/api/admin/withdrawal/:id/process', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const { action, notes } = req.body;
        const userId = req.user.userId;
        
        // Verify if user is admin (implement proper admin check)
        const [admins] = await connection.execute(
            'SELECT * FROM users WHERE id = ? AND email = ?',
            [userId, process.env.ADMIN_EMAIL || '']
        );
        
        if (admins.length === 0) {
            await connection.rollback();
            return res.status(403).json({ message: 'Unauthorized: Admin access required' });
        }
        
        // Get the transaction
        const [transactions] = await connection.execute(
            'SELECT * FROM transactions WHERE id = ? AND type = "withdrawal"',
            [id]
        );
        
        if (transactions.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Withdrawal request not found' });
        }
        
        const transaction = transactions[0];
        
        if (transaction.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ message: `Cannot process withdrawal that is already ${transaction.status}` });
        }
        
        if (action === 'approve') {
            // Mark as completed
            await connection.execute(
                'UPDATE transactions SET status = ?, admin_notes = ? WHERE id = ?',
                ['completed', notes || 'Approved by admin', id]
            );
            
            // Notify user (implement SMS notification)
            try {
                const message = `Your withdrawal of KES ${transaction.amount} has been processed and sent to your M-Pesa number ${transaction.phone_number}.`;
                await sendUserSMS(transaction.phone_number, message);
            } catch (smsError) {
                console.error('Failed to send user SMS notification:', smsError);
                // Continue despite SMS failure
            }
        } else if (action === 'reject') {
            if (!notes) {
                await connection.rollback();
                return res.status(400).json({ message: 'Rejection reason is required' });
            }
            
            // Mark as rejected
            await connection.execute(
                'UPDATE transactions SET status = ?, admin_notes = ? WHERE id = ?',
                ['rejected', notes, id]
            );
            
            // Return funds to user
            await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [transaction.amount, transaction.user_id]
            );
            
            // Notify user
            try {
                const message = `Your withdrawal of KES ${transaction.amount} has been rejected. Reason: ${notes}. The funds have been returned to your account.`;
                await sendUserSMS(transaction.phone_number, message);
            } catch (smsError) {
                console.error('Failed to send user SMS notification:', smsError);
                // Continue despite SMS failure
            }
        } else {
            await connection.rollback();
            return res.status(400).json({ message: 'Invalid action. Use "approve" or "reject".' });
        }
        
        // Mark notification as read
        await connection.execute(
            'UPDATE admin_notifications SET is_read = TRUE WHERE transaction_id = ?',
            [id]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: `Withdrawal ${action === 'approve' ? 'approved' : 'rejected'} successfully`
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Admin withdrawal processing error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing withdrawal request'
        });
    } finally {
        connection.release();
    }
});


app.get('/api/admin/withdrawals', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Verify if user is admin (implement proper admin check)
        const [admins] = await pool.execute(
            'SELECT * FROM users WHERE id = ? AND email = ?',
            [userId, process.env.ADMIN_EMAIL || '']
        );
        
        if (admins.length === 0) {
            return res.status(403).json({ message: 'Unauthorized: Admin access required' });
        }
        
        // Get all withdrawal requests with user details
        const [withdrawals] = await pool.execute(`
            SELECT t.*, u.name, u.email 
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.type = 'withdrawal'
            ORDER BY t.created_at DESC
        `);
        
        res.json(withdrawals);
    } catch (error) {
        console.error('Admin withdrawals error:', error);
        res.status(500).json({ message: 'Error fetching withdrawal requests' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 