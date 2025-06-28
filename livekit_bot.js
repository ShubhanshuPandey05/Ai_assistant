const { Room } = require('livekit-client');
const fetch = require('node-fetch');
require('dotenv').config();

const LIVEKIT_URL = 'wss://aiagent-i9rqezpr.livekit.cloud';
const BACKEND_URL = 'http://localhost:3001/api/livekit-token';

async function getToken(room, identity) {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, identity }),
  });
  const data = await res.json();
  return data.token;
}

async function startAIAgent(roomName, agentIdentity) {
  const token = await getToken(roomName, agentIdentity);
  const room = new Room();
  await room.connect(LIVEKIT_URL, token);
  console.log(`AI agent (${agentIdentity}) connected to room: ${roomName}`);
  // TODO: Publish TTS audio here
}

const roomName = process.argv[2] || 'ai-assistant-room';
const agentIdentity = process.argv[3] || 'ai-agent-bot';

startAIAgent(roomName, agentIdentity).catch(console.error); 