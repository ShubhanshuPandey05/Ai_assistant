const { WebSocketServer } = require('ws');
const { EgressClient } = require('livekit-server-sdk');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

dotenv.configDotenv()
const {
    LIVEKIT_URL,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    WEBSOCKET_PORT = "8080",
    EGRESS_WEBSOCKET_URL,
} = process.env;

if (![LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, EGRESS_WEBSOCKET_URL].every(Boolean)) {
    console.error("❌ Missing environment variables");
    process.exit(1);
}

const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

let egressSetup = false;
let wsServer = null;

function setupEgressServer() {
    if (wsServer || egressSetup) return;
    egressSetup = true;

    wsServer = new WebSocketServer({ port: +WEBSOCKET_PORT });
    console.log(`🎧 Listening for Egress audio on port ${WEBSOCKET_PORT}`);

    wsServer.on("connection", clientWs => {
        console.log("🔗 Egress client connected");

        const timestamp = Date.now();
        const outputPath = path.resolve(__dirname, `recording-${timestamp}.wav`);

        const ffmpeg = spawn('ffmpeg', [
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            '-i', 'pipe:0',
            '-ac', '1',
            '-ar', '16000',
            '-y',
            outputPath
        ]);

        ffmpeg.stderr.on("data", (data) => {
            console.error(`🛠️ FFmpeg stderr: ${data.toString()}`);
        });
          

        clientWs.on("message", chunk => {
            if (!ffmpeg.stdin.write(chunk)) {
                clientWs.pause();
                console.log("⏸️ Client WS paused due to backpressure");
            }
            ffmpeg.stdin.write(chunk)            
        });

        ffmpeg.stdin.on("drain", () => {
            clientWs.resume();
            console.log("▶️ Client WS resumed");
        });

        ffmpeg.on("exit", code => {
            console.log(`🛑 FFmpeg exited (code ${code}), file saved: ${outputPath}`);
        });

        clientWs.on("close", () => {
            console.log("🔒 Egress client disconnected — closing FFmpeg stdin");
            ffmpeg.stdin.end();
        });
    });
}

async function startEgressTranscription(trackId, roomName) {
    console.log("Track id: ",trackId, roomName);
    
    console.log(`🚀 Starting Egress for trackId: ${trackId}, roomName: ${roomName}`);
    if (!egressSetup) setupEgressServer();

    try {
        const info = await egressClient.startTrackEgress(roomName, EGRESS_WEBSOCKET_URL, trackId);
        console.log("✅ LiveKit Egress started:", info.egressId);
        return info.egressId;
    } catch (e) {
        console.error("❌ Error starting LiveKit Egress:", e.message);
        throw e.message;
    }
}

async function stopEgressTranscription(egressId) {
    try {
        await egressClient.stopEgress(egressId);
        console.log("🔌 LiveKit Egress stopped:", egressId);
    } catch (e) {
        console.error("❌ Error stopping LiveKit Egress:", e.message);
        throw e.message;
    }
}

module.exports = {
    setupEgressServer,
    startEgressTranscription,
    stopEgressTranscription,
};
