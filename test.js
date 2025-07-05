const { Room, RoomEvent, RemoteParticipant, LocalParticipant, AudioPresets, VideoPresets, TrackSource, AudioSource, LocalAudioTrack, AudioFrame, TrackKind, AudioStream } = require('@livekit/rtc-node');
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
require('dotenv').config();

(async () => {
    // Debug environment variables
    console.log('Environment variables:');
    console.log('LIVEKIT_URL:', process.env.LIVEKIT_URL ? 'Set' : 'NOT SET');
    console.log('LIVEKIT_API_KEY:', process.env.LIVEKIT_API_KEY ? 'Set' : 'NOT SET');
    console.log('LIVEKIT_API_SECRET:', process.env.LIVEKIT_API_SECRET ? 'Set' : 'NOT SET');

    // Check if required environment variables are set
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
        console.error('Missing required environment variables. Please check your .env file.');
        process.exit(1);
    }

    const room = new Room();
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: 'AI-Agent',
    });
    at.addGrant({ roomJoin: true, room: 'test' });

    let token;
    try {
        token = await at.toJwt();
        console.log('Generated JWT token:', typeof token, token ? token.substring(0, 50) + '...' : 'undefined');
        console.log(token)
    } catch (err) {
        console.error('Failed to generate JWT token:', err);
        process.exit(1);
    }

    console.log('Room object:', room);
    console.log('Attempting to connect to:', process.env.LIVEKIT_URL);

    // Add event listeners for debugging
    room.on(RoomEvent.Connected, () => {
        console.log('Successfully connected to room!');
    });

    room.on(RoomEvent.Disconnected, (reason) => {
        console.log('Disconnected from room:', reason);
    });

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
        console.log('Connection state changed:', state);
    });

    // Connect with error handling
    room.connect(process.env.LIVEKIT_URL, token, {
        name: 'test',
        emptyTimeout: 20 * 60,
        maxParticipants: 2,
    }).catch((error) => {
        console.error('Connection failed:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
    });
})();