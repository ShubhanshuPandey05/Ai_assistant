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
    session.interruption = true;
    session.isAIResponding = false;
    offset = mulawBuffer.length;
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
    if (chunk.length === 0) { session.isAIResponding = false; session.currentAudioStream = null; return; }
    try {
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: chunk.toString('base64') } }));
      offset += CHUNK_SIZE_MULAW;
      setTimeout(sendChunk, 100);
    } catch (e) {
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
  let isPublished = false;
  let audioQueue = [];
  let isStreaming = false;

  const stopFunction = () => {
    session.interruption = true;
    session.isAIResponding = false;
    session.currentAudioStream = null;
    audioQueue = [];
    if (isPublished && track) {
      try { room.localParticipant.unpublishTrack(track); } catch {}
    }
    if (onComplete) onComplete();
  };
  session.currentAudioStream = { stop: stopFunction };

  async function initializeAudioTrack() {
    source = new AudioSource(16000, 1);
    track = LocalAudioTrack.createAudioTrack('ai-response', source);
    await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE, name: 'ai-response' });
    isPublished = true;
  }

  const addAudioChunk = async (pcmArray) => {
    if (session.interruption) return;
    audioQueue.push(pcmArray);
    if (!isStreaming) { isStreaming = true; processAudioQueue(); }
  };

  async function processAudioQueue() {
    while (audioQueue.length > 0 && !session.interruption) {
      const pcmArray = audioQueue.shift();
      try {
        const audioFrame = new AudioFrame(pcmArray, 16000, 1, pcmArray.length);
        await source.captureFrame(audioFrame);
        const chunkDurationMs = (pcmArray.length / 16000) * 1000;
        await new Promise(r => setTimeout(r, chunkDurationMs+1000));
      } catch (e) { stopFunction(); return; }
    }
    if (audioQueue.length === 0) {
      isStreaming = false;
      setTimeout(() => { if (audioQueue.length === 0) stopFunction(); }, 100);
    }
  }

  initializeAudioTrack().catch(() => stopFunction());
  return addAudioChunk;
}

async function universalStreamAudio(connection, buffer, session) {
  if (connection instanceof WebSocket) {
    if (session.currentAudioStream) session.currentAudioStream.stop();
    const mulawBuffer = await convertMp3ToMulaw(buffer, session.id);
    if (mulawBuffer) streamMulawAudioToTwilio(connection, mulawBuffer, session);
  } else if (connection instanceof Room) {
    if (session.currentAudioStream) session.currentAudioStream.stop();
    const pcmBuffer = await convertMp3ToPcmInt16(buffer, session.id);
    const addAudioChunk = streamPCMAudioToLiveKit(connection, session);
    await addAudioChunk(pcmBuffer);
  }
}

module.exports = {
  convertMp3ToMulaw,
  convertMp3ToPcmInt16,
  streamMulawAudioToTwilio,
  streamPCMAudioToLiveKit,
  universalStreamAudio,
};


