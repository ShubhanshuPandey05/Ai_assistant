import { AccessToken } from 'livekit-server-sdk';

const apiKey = process.env.LIVEKIT_API_KEY || 'YOUR_API_KEY';
const apiSecret = process.env.LIVEKIT_API_SECRET || 'YOUR_API_SECRET';
const roomName = process.env.LIVEKIT_ROOM || 'testroom';
const identity = process.env.LIVEKIT_BOT_IDENTITY || 'ai-bot';

const at = new AccessToken(apiKey, apiSecret, {
  identity,
  ttl: 60 * 60,
});
at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

console.log(at.toJwt()); 