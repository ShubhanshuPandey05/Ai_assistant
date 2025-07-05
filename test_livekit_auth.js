const { AccessToken } = require('livekit-server-sdk');
require('dotenv').config();

console.log('Testing LiveKit authentication...');

// Check environment variables
console.log('Environment variables:');
console.log('LIVEKIT_URL:', process.env.LIVEKIT_URL);
console.log('LIVEKIT_API_KEY:', process.env.LIVEKIT_API_KEY ? process.env.LIVEKIT_API_KEY.substring(0, 10) + '...' : 'NOT SET');
console.log('LIVEKIT_API_SECRET:', process.env.LIVEKIT_API_SECRET ? process.env.LIVEKIT_API_SECRET.substring(0, 10) + '...' : 'NOT SET');

if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    console.error('Missing API credentials');
    process.exit(1);
}

try {
    // Test token generation
    console.log('Creating AccessToken...');
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: 'AI-Agent',
    });
    
    console.log('Adding grants...');
    at.addGrant({ roomJoin: true, room: 'test' });
    
    console.log('Generating JWT token...');
    const token = at.toJwt();
    console.log('Token generated successfully');
    console.log('Token type:', typeof token);
    console.log('Token length:', token ? token.length : 'undefined');
    console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'undefined');
    
    if (!token) {
        console.error('Token generation failed - token is undefined or null');
        process.exit(1);
    }
    
    // Test URL parsing
    const url = process.env.LIVEKIT_URL;
    console.log('LiveKit URL:', url);
    
    if (url && !url.startsWith('wss://') && !url.startsWith('ws://')) {
        console.error('Warning: LiveKit URL should start with wss:// or ws://');
    }
    
    // Try to extract hostname
    const urlObj = new URL(url);
    console.log('Hostname:', urlObj.hostname);
    console.log('Protocol:', urlObj.protocol);
    
    console.log('Authentication test completed successfully');
    
} catch (error) {
    console.error('Error during authentication test:', error);
    console.error('Error stack:', error.stack);
} 