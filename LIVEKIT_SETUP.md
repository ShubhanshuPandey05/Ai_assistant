# LiveKit AI Agent Setup Guide

## Overview
This setup enables real-time voice communication between users and your AI agent using LiveKit WebRTC rooms.

## Prerequisites
- LiveKit Cloud account (or self-hosted LiveKit server)
- LiveKit API Key and Secret
- Node.js and npm installed

## Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# LiveKit Configuration
LIVEKIT_URL=wss://your-project-id.livekit.cloud
LIVEKIT_API_KEY=your_api_key_here
LIVEKIT_API_SECRET=your_api_secret_here
LIVEKIT_ROOM_NAME=ai-assistant-room
LIVEKIT_BOT_TOKEN=your_bot_token_here

# Frontend Configuration (create .env in client/ directory)
REACT_APP_LIVEKIT_URL=wss://your-project-id.livekit.cloud
REACT_APP_LIVEKIT_ROOM=ai-assistant-room

# Your existing environment variables
DEEPGRAM_API_KEY=your_deepgram_key
OPEN_AI=your_openai_key
GABBER_VOICEID_MALE=your_gabber_voice_id
# ... other existing variables
```

## Installation Steps

### 1. Install Dependencies
```bash
# In project root
npm install

# In client directory
cd client
npm install
```

### 2. Generate Bot Token
```bash
# Run the token generator
node generate_bot_token.js
```
Copy the output token and set it as `LIVEKIT_BOT_TOKEN` in your `.env` file.

### 3. Start the Backend
```bash
# In project root
npm start
```
This will start:
- WebSocket server (port 5001)
- Express server (port 3001)
- LiveKit AI agent (joins room automatically)

### 4. Start the Frontend
```bash
# In client directory
npm run dev
```

## How It Works

### 1. AI Agent (Backend)
- Automatically joins the LiveKit room when server starts
- Listens for user audio
- Processes audio through STT → AI → TTS pipeline
- Publishes AI responses back to the room

### 2. User (Frontend)
- Connects to the same LiveKit room
- Can publish microphone audio
- Receives AI audio responses
- Can also use text chat

### 3. Real-time Communication
- Both user and AI agent are participants in the same room
- Audio flows bidirectionally in real-time
- Chat messages are sent via LiveKit data channels

## Testing

1. **Start both servers** (backend and frontend)
2. **Open the frontend** in your browser
3. **Click "Connect to Room"** - you should see the AI agent join
4. **Click "Start Talking"** - your microphone will be published to the room
5. **Speak** - the AI agent will process your audio and respond
6. **Use chat** - send text messages that the AI will respond to

## Troubleshooting

### Connection Issues
- Check your LiveKit URL and credentials
- Ensure the bot token is valid and not expired
- Check browser console for WebRTC errors

### Audio Issues
- Ensure microphone permissions are granted
- Check that audio devices are working
- Verify LiveKit room permissions

### AI Processing Issues
- Check Deepgram, OpenAI, and Gabber API keys
- Monitor server logs for processing errors
- Ensure all environment variables are set

## File Structure

```
├── server.js              # Main backend with LiveKit AI agent
├── livekit_bot.js         # Standalone bot (alternative)
├── generate_bot_token.js  # Token generator
├── client/
│   └── src/
│       └── App.jsx        # Frontend with LiveKit client
└── LIVEKIT_SETUP.md       # This file
```

## Next Steps

1. **Customize the AI prompt** in the frontend
2. **Add more functions** to the AI agent
3. **Implement user authentication** for secure rooms
4. **Add recording capabilities** for conversations
5. **Scale to multiple rooms** for different use cases 