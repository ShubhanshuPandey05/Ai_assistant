const { spawn } = require('child_process');
const { Room, LocalAudioTrack, AudioSource, AudioFrame, TrackSource } = require('@livekit/rtc-node');
const WebSocket = require('ws');

const CONFIG = {
  AUDIO_SAMPLE_RATE: 8000,
};

function convertMp3ToMulaw(mp3Buffer, sessionId) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 'mulaw', '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(), '-ac', '1', '-acodec', 'pcm_mulaw', '-y', 'pipe:1']);
    let mulawBuffer = Buffer.alloc(0);
    ffmpeg.stdout.on('data', data => { mulawBuffer = Buffer.concat([mulawBuffer, data]); });
    ffmpeg.on('close', code => code === 0 ? resolve(mulawBuffer) : reject(new Error(`ffmpeg exited ${code}`)));
    ffmpeg.on('error', reject);
    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();
  });
}

function convertMp3ToPcmInt16(mp3Buf, sessionId) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-y', 'pipe:1']);
    const chunks = [];
    let errOut = '';
    ff.stdout.on('data', chunk => chunks.push(chunk));
    ff.stderr.on('data', d => errOut += d.toString());
    ff.on('close', code => {
      if (code === 0) {
        const buffer = Buffer.concat(chunks);
        const pcmArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        resolve(pcmArray);
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${errOut}`));
      }
    });
    ff.on('error', reject);
    ff.stdin.end(mp3Buf);
  });
}

function streamMulawAudioToTwilio(ws, mulawBuffer, session) {
  let streamSid = session.streamSid;
  const CHUNK_SIZE_MULAW = 800;
  let offset = 0;
  session.isAIResponding = true;
  session.interruption = false;

  const stopFunction = () => {
    console.log(`Session ${session.id}: Immediately stopping Twilio audio stream`);
    session.interruption = true;
    session.isAIResponding = false;
    offset = mulawBuffer.length; // Skip to end to stop immediately
    session.currentAudioStream = null;
  };
  session.currentAudioStream = { stop: stopFunction };

  function sendChunk() {
    if (offset >= mulawBuffer.length || session.interruption) {
      session.isAIResponding = false;
      session.currentAudioStream = null;
      return;
    }
    const chunk = mulawBuffer.slice(offset, offset + CHUNK_SIZE_MULAW);
    if (chunk.length === 0) { 
      session.isAIResponding = false; 
      session.currentAudioStream = null; 
      return; 
    }
    try {
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: chunk.toString('base64') } }));
      offset += CHUNK_SIZE_MULAW;
      setTimeout(sendChunk, 100);
    } catch (e) {
      console.error(`Error sending Twilio audio chunk: ${e.message}`);
      stopFunction();
    }
  }
  sendChunk();
}

function streamPCMAudioToLiveKit(room, session, onComplete) {
  const CHUNK_SIZE_PCM = 800;
  session.isAIResponding = true;
  session.interruption = false;

  let source = null;
  let track = null;
  let publishedTrackSid = null;
  let isPublished = false;
  let audioQueue = [];
  let isStreaming = false;
  let isStopping = false;
  let unpublishRequested = false;
  let hasCleanedUp = false;

  async function cleanupTrack() {
    if (hasCleanedUp) return;
    hasCleanedUp = true;

    const sid = publishedTrackSid;
    isPublished = false;
    publishedTrackSid = null;

    if (sid && room && room.localParticipant) {
      try {
        await room.localParticipant.unpublishTrack(sid, false);
        console.log(`Session ${session.id}: Unpublished audio track`);
      } catch (e) {
        console.error(`Error unpublishing track: ${e.message}`);
      }
    }
  }

  const stopFunction = () => {
    if (isStopping) return;
    isStopping = true;
    unpublishRequested = true;

    console.log(`Session ${session.id}: Immediately stopping LiveKit audio stream`);
    session.interruption = true;
    session.isAIResponding = false;
    session.currentAudioStream = null;
    audioQueue = []; // Clear the queue immediately

    if (!isStreaming) {
      cleanupTrack().finally(() => {
        if (onComplete) onComplete();
      });
      return;
    }
    
    if (onComplete) onComplete();
  };
  session.currentAudioStream = { stop: stopFunction };

  async function initializeAudioTrack() {
    try {
      source = new AudioSource(16000, 1);
      track = LocalAudioTrack.createAudioTrack('ai-response', source);
      const publication = await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE, name: 'ai-response' });
      publishedTrackSid = publication && publication.sid ? publication.sid : null;
      isPublished = true;
      console.log(`Published audio track for session ${session.id}`);

      if (unpublishRequested && !isStreaming) {
        await cleanupTrack();
      }
    } catch (e) {
      console.error(`Error initializing audio track: ${e.message}`);
      stopFunction();
    }
  }

  const addAudioChunk = async (pcmArray) => {
    if (session.interruption) return;
    audioQueue.push(pcmArray);
    if (!isStreaming) { 
      isStreaming = true; 
      processAudioQueue(); 
    }
  };

  async function processAudioQueue() {
    while (audioQueue.length > 0 && !session.interruption) {
      const pcmArray = audioQueue.shift();
      try {
        const audioFrame = new AudioFrame(pcmArray, 16000, 1, pcmArray.length);
        await source.captureFrame(audioFrame);
        const chunkDurationMs = (pcmArray.length / 16000) * 1000;
        await new Promise(r => setTimeout(r, chunkDurationMs));
      } catch (e) { 
        console.error(`Error processing audio frame: ${e.message}`);
        stopFunction(); 
        return; 
      }
    }

    if (session.interruption) {
      isStreaming = false;
      if (unpublishRequested) {
        await cleanupTrack();
      }
      return;
    }

    if (audioQueue.length === 0) {
      isStreaming = false;
      setTimeout(() => { 
        if (audioQueue.length === 0 && !session.interruption) {
          stopFunction(); 
        }
      }, 100);
    }
  }

  initializeAudioTrack().catch(() => stopFunction());
  return addAudioChunk;
}

async function universalStreamAudio(connection, buffer, session) {
  // Immediately stop any existing audio stream to prioritize the latest
  if (session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
    console.log(`Session ${session.id}: Immediately stopping existing audio stream for latest audio`);
    try {
      session.currentAudioStream.stop();
    } catch (error) {
      console.error(`Session ${session.id}: Error stopping audio stream:`, error);
    }
  }

  // Force clear immediately - no waiting
  session.currentAudioStream = null;
  session.isAIResponding = false;
  session.interruption = false;

  if (connection instanceof WebSocket) {
    const mulawBuffer = await convertMp3ToMulaw(buffer, session.id);
    if (mulawBuffer) {
      streamMulawAudioToTwilio(connection, mulawBuffer, session);
    }
  } else if (connection instanceof Room) {
    const pcmBuffer = await convertMp3ToPcmInt16(buffer, session.id);
    if (pcmBuffer) {
      const addAudioChunk = streamPCMAudioToLiveKit(connection, session);
      await addAudioChunk(pcmBuffer);
    }
  }
}

// Utility function to safely stop audio streams
function safelyStopAudioStream(session) {
  if (session && session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
    try {
      console.log(`Safely stopping audio stream for session ${session.id}`);
      session.currentAudioStream.stop();
      session.currentAudioStream = null;
      session.isAIResponding = false;
      session.interruption = false;
      return true;
    } catch (error) {
      console.error(`Error safely stopping audio stream for session ${session.id}:`, error);
      // Force clear even if stop fails
      session.currentAudioStream = null;
      session.isAIResponding = false;
      session.interruption = false;
      return false;
    }
  }
  return true;
}

module.exports = {
  convertMp3ToMulaw,
  convertMp3ToPcmInt16,
  streamMulawAudioToTwilio,
  streamPCMAudioToLiveKit,
  universalStreamAudio,
  safelyStopAudioStream,
};


