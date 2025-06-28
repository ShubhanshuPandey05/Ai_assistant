const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    console.log('🧪 Mock client connected, sending test PCM data...');

    const interval = setInterval(() => {
        // Send fake raw PCM data: 48kHz, 2-channel, 16-bit = 192,000 bytes/sec
        const dummyAudio = Buffer.alloc(48000 * 2 * 2 / 10); // 100ms of silence
        ws.send(dummyAudio);
    }, 100);

    setTimeout(() => {
        clearInterval(interval);
        ws.close();
        console.log('✅ Done sending test data. Closing connection.');
    }, 5000); // 5 seconds
});

ws.on('close', () => {
    console.log('🔌 Mock WebSocket closed');
});

ws.on('error', (err) => {
    console.error('❌ WS Error:', err);
});
