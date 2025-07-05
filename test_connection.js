const https = require('https');
const http = require('http');

// Test the LiveKit server connectivity
const testUrl = 'wss://aiagent-i9rqezpr.livekit.cloud';
const httpUrl = 'https://aiagent-i9rqezpr.livekit.cloud';

console.log('Testing connectivity to LiveKit server...');
console.log('URL:', httpUrl);

// Test HTTP connectivity first
const req = https.get(httpUrl, (res) => {
    console.log('HTTP Status:', res.statusCode);
    console.log('Headers:', res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('Response body length:', data.length);
        console.log('Response body (first 200 chars):', data.substring(0, 200));
    });
});

req.on('error', (error) => {
    console.error('HTTP request failed:', error.message);
});

req.setTimeout(10000, () => {
    console.error('Request timed out');
    req.destroy();
}); 