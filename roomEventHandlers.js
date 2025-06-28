const { RoomEvent } = require('livekit-client');
const {
    startEgressTranscription,
    stopEgressTranscription,
    setupEgressServer
} = require('./egressModule'); // Update path if needed

const participantEgressMap = new Map();
const audioBuffers = new Map(); // Optional: only include if needed by your logic

function setupRoomEventHandlers(aiRoom, roomName, handleIncomingTrack) {
    aiRoom.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
        if (track.kind === 1 || track.kind === 'audio') {
            console.log('🎵 Audio track subscribed - Egress will handle audio capture');
            console.log(`🚀 Starting egress for trackId: ${track.sid}, roomName: ${roomName}`);

            try {
                setupEgressServer(); // Ensure server is listening

                const egressId = await startEgressTranscription(track.sid, roomName);
                participantEgressMap.set(participant.identity, egressId);
                console.log(`🎙️ Egress ID for ${participant.identity}: ${egressId}`);
            } catch (e) {
                console.error('❌ Error starting LiveKit Egress:', e);
            }
        }

        if (typeof handleIncomingTrack === 'function') {
            handleIncomingTrack(track, publication, participant, roomName);
        }
    });

    aiRoom.on(RoomEvent.TrackPublished, async (publication, participant) => {
        if ((publication.kind === 'audio' || publication.kind === 1) && !publication.isSubscribed) {
            try {
                console.log(`🔄 Auto-subscribing to audio from ${participant.identity}`);
                await publication.setSubscribed(true);
                console.log(`✅ Subscribed to audio from ${participant.identity}`);
            } catch (e) {
                console.error(`❌ Failed to subscribe to audio from ${participant.identity}:`, e);
            }
        }
    });

    aiRoom.on(RoomEvent.ParticipantDisconnected, async (participant) => {
        console.log('👤 Participant disconnected:', participant.identity);

        const egressId = participantEgressMap.get(participant.identity);
        if (egressId) {
            try {
                await stopEgressTranscription(egressId);
                console.log(`🔌 Egress stopped for ${participant.identity}`);
            } catch (e) {
                console.error('❌ Error stopping egress:', e);
            }
            participantEgressMap.delete(participant.identity);
        }

        if (audioBuffers.has(participant.identity)) {
            audioBuffers.delete(participant.identity);
            console.log(`🧹 Cleaned up audio buffer for ${participant.identity}`);
        }
    });

    aiRoom.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (quality === 'poor') {
            console.warn(`⚠️ Poor connection quality for ${participant?.identity || 'local'}`);
        }
    });

    aiRoom.on(RoomEvent.Reconnecting, () => {
        console.log('🔄 AI agent reconnecting...');
    });

    aiRoom.on(RoomEvent.Reconnected, () => {
        console.log('✅ AI agent reconnected');
    });
}

module.exports = { setupRoomEventHandlers };
