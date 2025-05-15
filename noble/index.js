
const API_BASE_URL = 'http://localhost:3000/api';

// Authentication State
let currentUser = null;
let authToken = localStorage.getItem('authToken');

// Global variable to track transaction type
let currentTransactionType = 'deposit';

// API Helper Functions
async function apiRequest(endpoint, method = 'GET', data = null, requiresAuth = false) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (requiresAuth && authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const config = {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'API request failed');
        }

        return result;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Authentication Functions
async function handleSignIn(event) {
    event.preventDefault();
    const email = document.getElementById('signInEmail').value;
    const password = document.getElementById('signInPassword').value;

    try {
        const response = await apiRequest('/signin', 'POST', { email, password });
        authToken = response.token;
        localStorage.setItem('authToken', authToken);
        currentUser = response.user;
        
        // Redirect to dashboard after successful login
        window.location.href = 'dash.html';
        showNotification('Successfully signed in!', 'success');
    } catch (error) {
        showNotification(error.message || 'Failed to sign in', 'error');
    }
}

async function handleSignUp(event) {
    event.preventDefault();
    const email = document.getElementById('signUpEmail').value;
    const password = document.getElementById('signUpPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const name = document.getElementById('signUpName').value;

    if (password !== confirmPassword) {
        showNotification('Passwords do not match', 'error');
        return;
    }

    try {
        await apiRequest('/signup', 'POST', { email, password, name });
        showNotification('Account created successfully! Please sign in.', 'success');
        
        // Redirect to sign in page
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } catch (error) {
        showNotification(error.message || 'Failed to create account', 'error');
    }
}

// Payment Processing Functions
async function handlePayment(event) {
    event.preventDefault();
    const amount = document.getElementById('paymentAmount').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const phoneNumber = document.getElementById('accountDetails').value;

    if (!authToken) {
        showNotification('Please sign in to make a payment', 'error');
        window.location.href = 'index.html';
        return;
    }

    try {
        // Use different endpoints for deposit and withdraw
        const endpoint = currentTransactionType === 'deposit' 
            ? '/payment/mpesa' 
            : '/withdraw/mpesa';
        
        const response = await apiRequest(endpoint, 'POST', 
            { amount, paymentMethod, phoneNumber, type: currentTransactionType }, true);
        
        if (response.success) {
            const actionText = currentTransactionType === 'deposit' ? 'Deposit' : 'Withdrawal';
            showNotification(`${actionText} initiated. Please complete the process.`, 'success');
            hidePaymentForm();
            // Poll for payment status
            pollPaymentStatus(response.transactionId);
        }
    } catch (error) {
        showNotification(error.message || 'Payment processing failed', 'error');
    }
}

window.addEventListener('error', (event) => {
    console.error('Global error:', event.message);
    showNotification('An unexpected error occurred', 'error');
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showNotification('An unexpected error occurred', 'error');
  });
// Poll payment status
async function pollPaymentStatus(transactionId) {
    let attempts = 0;
    const maxAttempts = 30; // Poll for 5 minutes (30 * 10 seconds)
    const baseDelay = 5000;

    const poll = async () => {
        try {
            const response = await apiRequest(`/payment/mpesa/status/${transactionId}`, 'GET', null, true);
            
            if (response.status === 'completed') {
                showNotification('Payment completed successfully!', 'success');
                // Refresh user data
                await loadUserProfile();
                return;
            } else if (response.status === 'failed') {
                showNotification('Payment failed. Please try again.', 'error');
                return;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
            const delay = baseDelay * Math.pow(2, attempts / 5);
                setTimeout(poll, delay); // Check every 10 seconds
            } else {
                showNotification('Payment status check timed out. Please check your balance.', 'warning');
            }
        } catch (error) {
            console.error('Error checking payment status:', error);
        }
    };

    poll();
}

async function loadUserProfile() {
    console.log('Loading user profile...');
    try {
        const user = await apiRequest('/user/profile', 'GET', null, true);
        currentUser = user;
        updateUIForLoggedInUser(user);
        console.log('Updating UI for user:', user);
    } catch (error) {
        console.error('Failed to load user profile:', error);
    }
}

async function loadTransactionHistory() {
    console.log('Loading transaction history...');
    try {
        const transactions = await apiRequest('/user/transactions', 'GET', null, true);
        updateTransactionHistory(transactions);
        console.log('Updating transaction history:', transactions);
    } catch (error) {
        console.error('Failed to load transaction history:', error);
    }
}

// Portfolio loading
async function loadPortfolios() {
    console.log('Loading portfolios...');
    try {
        const portfolios = await apiRequest('/portfolios', 'GET', null, true);
        updatePortfolioGrid(portfolios);
        console.log('Updating portfolios:', portfolios);
    } catch (error) {
        console.error('Failed to load portfolios:', error);
    }
}

function updatePortfolioGrid(portfolios) {
    const grid = document.getElementById('portfolioGrid');
    if (!grid) return;
    
    grid.innerHTML = portfolios.map(portfolio => `
        <div class="portfolio-card">
            <div class="portfolio-image">
                <img src="${portfolio.image}" alt="${portfolio.name}">
            </div>
            <div class="portfolio-name">${portfolio.name}</div>
            <div class="portfolio-price">KES ${portfolio.price}</div>
            <div class="portfolio-return">${portfolio.returnRate}% Daily Return</div>
            <button class="portfolio-btn" data-id="${portfolio.id}">Invest Now</button>
        </div>
    `).join('');
    
    // Add event listeners to portfolio buttons
    const buttons = grid.querySelectorAll('.portfolio-btn');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const portfolioId = button.getAttribute('data-id');
            showPaymentForm();
            // You can store the portfolio ID in a hidden input if needed
        });
    });
}

function updateUIForLoggedInUser(user) {
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const walletBalance = document.getElementById('walletBalance');
    const walletInvestments = document.getElementById('walletInvestments');
    const investmentReturns = document.getElementById('investmentReturns');
    const deposits = document.getElementById('deposits');
    const withdrawals = document.getElementById('withdrawals');

    if (userAvatar) userAvatar.textContent = user.name ? user.name.charAt(0) : 'U';
    if (userName) userName.textContent = user.name || 'User';
    if (walletBalance) walletBalance.textContent = `KES ${user.balance || 0.0}`;
    if (walletInvestments) walletInvestments.textContent = `KES ${user.investments || 0.0}: Investments`;
    if (investmentReturns) investmentReturns.textContent = `KES ${user.returns || 0.00}`;
    if (deposits) deposits.textContent = `KES ${user.deposits || 0.00}`;
    if (withdrawals) withdrawals.textContent = `KES ${user.withdrawals || 0.00}`;
    console.log('Updating UI for user:', user);
}

function updateTransactionHistory(transactions) {
    const historyContainer = document.querySelector('.transaction-history');
    if (!historyContainer) return;

    if (transactions.length === 0) {
        historyContainer.innerHTML = '<div class="no-transactions">No transactions found.</div>';
        return;
    }

    historyContainer.innerHTML = transactions.map(transaction => {
        const amount = Number(transaction.amount) || 0;
        return `
            <div class="transaction-item">
                <div class="transaction-type ${transaction.type}">${transaction.type}</div>
                <div class="transaction-amount">KES ${amount.toFixed(2)}</div>
                <div class="transaction-method">${transaction.method}</div>
                <div class="transaction-date">${new Date(transaction.date).toLocaleDateString()}</div>
                <div class="transaction-status ${transaction.status}">${transaction.status}</div>
            </div>
        `;
    }).join('');
    console.log('Updating transaction history:', transactions);
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => notification.remove();

    notification.appendChild(closeBtn);
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Helper functions for dashboard.html page
function showPaymentForm() {
    console.log('Showing payment form');
    const paymentContainer = document.getElementById('paymentContainer');
    if (paymentContainer) {
        paymentContainer.classList.remove('hidden');
    } else {
        // console.error('Payment container not found!');
    }
}

function hidePaymentForm() {
    const paymentContainer = document.getElementById('paymentContainer');
    if (paymentContainer) {
        paymentContainer.classList.add('hidden');
    }
}

// Initialize - Different behavior based on which page we're on
document.addEventListener('DOMContentLoaded', () => {
    // console.log('DOM loaded');
    
    const pageURL = window.location.pathname;
    
    // Check if we're on the dashboard page
    if (pageURL.includes('dash.html')) {
        const token = localStorage.getItem('authToken');
        if (!token) {
            // Redirect to login if no token
            window.location.href = 'index.html';
            return;
        }
        
        authToken = token;
        loadUserProfile();
        loadTransactionHistory();
        loadPortfolios();
        
        // Attach dashboard-specific event listeners
        const paymentForm = document.getElementById('paymentForm');
        if (paymentForm) {
            paymentForm.addEventListener('submit', handlePayment);
        }
        
        const depositBtn = document.getElementById('depositBtn');
        console.log('Deposit button:', depositBtn);
        
        if (depositBtn) {
            console.log('Adding click listener to deposit button');
            depositBtn.addEventListener('click', () => {
                console.log('Deposit button clicked');
                currentTransactionType = 'deposit';
                showPaymentForm();
                const paymentTitle = document.querySelector('.payment-title');
                if (paymentTitle) {
                    paymentTitle.textContent = 'Make a Deposit';
                }
            });
        }
        
        const withdrawBtn = document.getElementById('withdrawBtn');
        console.log('Withdraw button:', withdrawBtn);
        
        if (withdrawBtn) {
            console.log('Adding click listener to withdraw button');
            withdrawBtn.addEventListener('click', () => {
                console.log('Withdraw button clicked');
                currentTransactionType = 'withdraw';
                showPaymentForm();
                const paymentTitle = document.querySelector('.payment-title');
                if (paymentTitle) {
                    paymentTitle.textContent = 'Make a Withdrawal';
                }
            });
        }
        
        const activateBtn = document.getElementById('activateBtn');
        if (activateBtn) {
            activateBtn.addEventListener('click', async () => {
                try {
                    const response = await apiRequest('/activate-earnings', 'POST', {}, true);
                    if (response.success) {
                        showNotification('Earnings activated successfully!', 'success');
                        loadUserProfile(); // Refresh user data
                    }
                } catch (error) {
                    showNotification(error.message || 'Failed to activate earnings', 'error');
                }
            });
        }
        
        const logoutBtn = document.getElementById('logoutBtn');
        console.log('Logout button:', logoutBtn);
        
        if (logoutBtn) {
            console.log('Adding click listener to logout button');
            logoutBtn.addEventListener('click', () => {
                console.log('Logout button clicked');
                localStorage.removeItem('authToken');
                window.location.href = 'index.html';
            });
        }
    }
    // Check if we're on the sign-in page
    else if (pageURL.includes('index.html') || pageURL === '/' || pageURL === '') {
        const token = localStorage.getItem('authToken');
        if (token) {
            // If already logged in, redirect to dashboard
            window.location.href = 'dash.html';
            return;
        }
        
        const signInForm = document.getElementById('signInForm');
        if (signInForm) {
            signInForm.addEventListener('submit', handleSignIn);
        }
    }
    // Check if we're on the sign-up page
    else if (pageURL.includes('signup.html')) {
        const token = localStorage.getItem('authToken');
        if (token) {
            // If already logged in, redirect to dashboard
            window.location.href = 'dash.html';
            return;
        }
        
        const signUpForm = document.getElementById('signUpForm');
        if (signUpForm) {
            signUpForm.addEventListener('submit', handleSignUp);
        }
    }
});

let logoutTimer;
function resetInactivityTimer() {
  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    localStorage.removeItem('authToken');
    window.location.href = 'index.html';
    alert('You have been logged out due to inactivity.');
  }, 15 * 60 * 1000);
}
['click', 'keypress', 'mousemove'].forEach(evt => document.addEventListener(evt, resetInactivityTimer));
resetInactivityTimer();