# WhatsApp Bot

A feature-rich WhatsApp bot with status viewing, message tracking, and more.

## Features
- Auto views all statuses
- Auto reacts to statuses with emojis
- Auto likes statuses with ❤️
- Captures and notifies about deleted messages
- Normal WhatsApp behavior with blue ticks
- Media backup capabilities
- Status viewer built-in
- Persistent storage on Railway

## Railway Deployment

1. Fork this repository to your GitHub account
2. Go to [Railway](https://railway.app/) and create a new account if you haven't already
3. Click "New Project" and select "Deploy from GitHub repo"
4. Select your forked repository
5. In Railway dashboard:
   - Go to your project
   - Click on "Variables"
   - Add `RAILWAY_VOLUME_MOUNT_PATH=/data`
6. Railway will automatically detect the Node.js project and start deployment
7. Once deployed, go to the "Deployments" tab and click on the latest deployment
8. Go to the "Logs" tab to see the QR code
9. Scan the QR code with your WhatsApp to connect the bot

## Storage
The bot uses Railway's persistent storage to save:
- Authentication data
- Messages
- Status updates
- Media files
- Deleted messages

All data is stored in the `/data` directory which persists across container restarts.

## Commands
- `!help` - Show help message
- `!deleted` - Show recently deleted messages
- `!status` - Show current status settings
- `!viewstatus` - View recent status updates
- `!toggleview` - Toggle auto status viewing
- `!togglereact` - Toggle auto status reactions
- `!togglelike` - Toggle auto status likes
- `!togglemedia` - Toggle media saving
- `!stats` - Show bot statistics
- `!about` - Show bot information

## Note
The bot uses local file storage which is ephemeral on Railway. Files will be lost if the container restarts.