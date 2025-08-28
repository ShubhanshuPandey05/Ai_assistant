const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = require('../config');

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

module.exports = {
  roomService,
};



