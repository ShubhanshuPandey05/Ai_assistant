import { useEffect, useRef, useState } from 'react';

const App = () => {
  const [recording, setRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastInterimTimeRef = useRef(0);
  const INTERIM_THRESHOLD = 500;
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [latency, setLatency] = useState({
    llm: 0,
    stt: 0,
    tts: 0
  });

  // Audio processing refs for μ-law
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const audioBufferRef = useRef([]);

  // Audio constants
  const SAMPLE_RATE = 44100;
  const TARGET_SAMPLE_RATE = 8000;
  const BUFFER_SIZE = 512;
  const CHUNK_SIZE = 400; // 50ms at 8kHz

  // μ-law encoding table
  const muLawCompressTable = new Uint8Array([
    0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
  ]);

  // μ-law decoding table
  const muLawDecompressTable = new Int16Array([
    -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
    -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
    -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
    -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
    -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
    -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
    -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
    -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
    -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
    -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
    -876, -844, -812, -780, -748, -716, -684, -652,
    -620, -588, -556, -524, -492, -460, -428, -396,
    -372, -356, -340, -324, -308, -292, -276, -260,
    -244, -228, -212, -196, -180, -164, -148, -132,
    -120, -112, -104, -96, -88, -80, -72, -64,
    -56, -48, -40, -32, -24, -16, -8, 0,
    32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
    23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
    15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
    11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
    7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
    5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
    3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
    2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
    1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
    1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
    876, 844, 812, 780, 748, 716, 684, 652,
    620, 588, 556, 524, 492, 460, 428, 396,
    372, 356, 340, 324, 308, 292, 276, 260,
    244, 228, 212, 196, 180, 164, 148, 132,
    120, 112, 104, 96, 88, 80, 72, 64,
    56, 48, 40, 32, 24, 16, 8, 0
  ]);

  // μ-law encoding function
  const encodeMuLaw = (sample) => {
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > 32635) sample = 32635;

    sample = sample + 132;
    let exponent = muLawCompressTable[(sample >> 7) & 0xFF] + 1;
    let mantissa = (sample >> (exponent + 3)) & 0x0F;

    return (~(sign | (exponent << 4) | mantissa)) & 0xFF;
  };

  // μ-law decoding function
  const decodeMuLaw = (muLawByte) => {
    return muLawDecompressTable[muLawByte];
  };

  // Downsample buffer from 44.1kHz to 8kHz
  const downsampleBuffer = (buffer, inputSampleRate, outputSampleRate) => {
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const origin = Math.floor(i * sampleRateRatio);
      result[i] = buffer[origin];
    }
    return result;
  };

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, interimTranscript]);

  const cleanup = () => {
    if (wsRef.current && sessionId) {
      wsRef.current.send(JSON.stringify({
        type: 'stop_session',
        sessionId: sessionId
      }));
      wsRef.current.close();
    }

    // Clean up audio processing
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    audioBufferRef.current = [];
  };

  const setupAudioAnalysis = (stream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyserRef.current = audioContextRef.current.createAnalyser();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(analyserRef.current);
    analyserRef.current.fftSize = 256;

    const updateAudioLevel = () => {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average);
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();
  };

  const setupAudioProcessing = (stream) => {
    streamRef.current = stream;

    // Create audio context if not exists
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    processorRef.current = audioContextRef.current.createScriptProcessor(BUFFER_SIZE, 1, 1);

    processorRef.current.onaudioprocess = (event) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const inputBuffer = event.inputBuffer.getChannelData(0);

        // Downsample from 44100 to 8000 Hz
        const downsampledBuffer = downsampleBuffer(inputBuffer, SAMPLE_RATE, TARGET_SAMPLE_RATE);

        // Add to buffer
        audioBufferRef.current.push(...downsampledBuffer);

        // Process chunks of CHUNK_SIZE
        while (audioBufferRef.current.length >= CHUNK_SIZE) {
          const chunk = audioBufferRef.current.splice(0, CHUNK_SIZE);

          // Convert float samples to 16-bit PCM
          const pcmData = new Int16Array(chunk.length);
          for (let i = 0; i < chunk.length; i++) {
            pcmData[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32768));
          }

          // Encode to μ-law
          const muLawData = new Uint8Array(pcmData.length);
          for (let i = 0; i < pcmData.length; i++) {
            muLawData[i] = encodeMuLaw(pcmData[i]);
          }

          // Convert to base64
          const base64 = btoa(String.fromCharCode.apply(null, muLawData));

          // Send as media event (compatible with Twilio format)
          wsRef.current.send(JSON.stringify({
            event: 'media',
            streamSid: sessionId,
            media: {
              payload: base64,
              encoding: 'mulaw',
              sampleRate: 8000,
              channels: 1
            }
          }));
        }
      }
    };

    sourceRef.current.connect(processorRef.current);
    processorRef.current.connect(audioContextRef.current.destination);
  };

  const playNextAudio = async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current) {
      return;
    }

    isPlayingRef.current = true;
    const { audioData, isInterim } = audioQueueRef.current.shift();

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      let audioBuffer;

      // Check if audioData is μ-law encoded (base64 string) or regular audio data
      if (typeof audioData === 'string') {
        // Decode μ-law base64 to PCM
        const binaryData = atob(audioData);
        const muLawData = new Uint8Array(binaryData.length);

        for (let i = 0; i < binaryData.length; i++) {
          muLawData[i] = binaryData.charCodeAt(i);
        }

        // Decode μ-law to PCM
        const pcmData = new Int16Array(muLawData.length);
        for (let i = 0; i < muLawData.length; i++) {
          pcmData[i] = decodeMuLaw(muLawData[i]);
        }

        // Create audio buffer
        audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, TARGET_SAMPLE_RATE);
        const channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < pcmData.length; i++) {
          channelData[i] = pcmData[i] / 32768.0; // Convert to float [-1, 1]
        }
      } else {
        // Regular audio buffer
        audioBuffer = await audioContextRef.current.decodeAudioData(audioData);
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        setIsPlaying(false);
        playNextAudio();
      };

      setIsPlaying(true);
      source.start(0);
    } catch (err) {
      console.error('Error playing audio:', err);
      isPlayingRef.current = false;
      setIsPlaying(false);
      playNextAudio();
    }
  };

  const queueAudio = (audioData, isInterim) => {
    const now = Date.now();

    if (isInterim && now - lastInterimTimeRef.current < INTERIM_THRESHOLD) {
      return;
    }

    if (isInterim) {
      lastInterimTimeRef.current = now;
    }

    audioQueueRef.current.push({ audioData, isInterim });
    if (!isPlayingRef.current) {
      playNextAudio();
    }
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    console.log('Sending chat message:', chatInput);

    wsRef.current.send(JSON.stringify({
      type: 'chat',
      message: chatInput
    }));
    setChatInput('');
  };

  const handleChatInput = (e) => {
    setChatInput(e.target.value);
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setupAudioAnalysis(stream);

      // Connect to WebSocket
      wsRef.current = new WebSocket('ws://localhost:5001');

      wsRef.current.onopen = () => {
        console.log('WebSocket connected, starting session...');

        // Generate session ID (similar to streamSid)
        const sid = 'MZ' + Math.random().toString(36).substr(2, 32);
        setSessionId(sid);

        // Initialize session with the server
        wsRef.current.send(JSON.stringify({
          event: 'start',
          streamSid: sid,
          type: 'start_session'
        }));

        // Setup audio processing for μ-law
        setupAudioProcessing(stream);
        setIsConnected(true);
        setRecording(true);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);

          if (data.type === 'session_started') {
            console.log('Session started with ID:', data.sessionId || sessionId);

          } else if (data.event === 'media' && data.media?.payload) {
            // Handle μ-law audio from server
            queueAudio(data.media.payload, false);

          } else if (data.type === 'audio') {
            // Handle regular base64 audio
            const binaryString = window.atob(data.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            queueAudio(bytes.buffer, !data.isFinal);

            if (data.latency) {
              setLatency({
                llm: data.latency.llm || 0,
                stt: data.latency.stt || 0,
                tts: data.latency.tts || 0
              });
            }

          } else if (data.type === 'tts_error') {
            console.error('TTS Error:', data.error);
            setError('TTS Error: ' + data.error);

          } else if (data.transcript) {
            if (data.isInterim) {
              setInterimTranscript(data.transcript);
            } else {
              setTranscript(prev => prev + ' ' + data.transcript);
              setInterimTranscript('');
            }

          } else if (data.type === 'text' || data.type === 'text_response') {
            console.log('Text response:', data.text);
            setChatMessages(prev => [...prev, { role: 'assistant', content: data.text }]);

          } else if (data.error) {
            setError(data.error);
            console.error('Server error:', data.error);
          }

        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
          setError('Error parsing server response');
        }
      };

      wsRef.current.onerror = (error) => {
        setError('WebSocket connection error');
        console.error('WebSocket error:', error);
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setSessionId(null);

        if (recording && !event.wasClean) {
          setTimeout(() => {
            if (recording) {
              console.log('Attempting to reconnect...');
              startRecording();
            }
          }, 2000);
        }
      };

    } catch (err) {
      setError('Failed to access microphone: ' + err.message);
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    cleanup();
    setRecording(false);
    setIsConnected(false);
    setSessionId(null);
    setAudioLevel(0);
    setInterimTranscript('');
  };

  const clearTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6">
      {/* Header */}
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-wide">🎙️ Voice Agent Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">8kHz μ-law Audio Streaming</p>
        {sessionId && (
          <p className="text-xs text-blue-400 mt-1">Session: {sessionId}</p>
        )}
      </header>

      {/* Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Connection</p>
          <div className={`mt-1 text-lg font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Format: 8kHz μ-law mono
          </div>
          {error && <div className="mt-2 text-red-300 text-sm">{error}</div>}
          {isPlaying && <div className="mt-2 text-blue-300 text-sm">Playing back...</div>}
        </div>

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300 mb-1">Audio Level</p>
          <div className="w-full bg-gray-600 h-3 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${recording ? 'bg-green-500' : 'bg-gray-300'}`}
              style={{ width: `${audioLevel}%` }}
            ></div>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Chunk: 50ms ({CHUNK_SIZE} samples)
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Latency (ms)</p>
          <div className="mt-2 space-y-1">
            <p><span className="text-gray-400">LLM:</span> {latency.llm}</p>
            <p><span className="text-gray-400">STT:</span> {latency.stt}</p>
            <p><span className="text-gray-400">TTS:</span> {latency.tts}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        {recording ? (
          <button
            onClick={stopRecording}
            className="bg-red-600 hover:bg-red-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            ⏹ Stop Recording
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="bg-green-600 hover:bg-green-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            🎙️ Start Recording
          </button>
        )}
        <button
          onClick={clearTranscript}
          className="bg-yellow-600 hover:bg-yellow-700 transition px-6 py-2 rounded-full font-semibold shadow"
        >
          🧹 Clear Transcript
        </button>
      </div>

      {/* Transcript */}
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
        <h2 className="text-2xl font-bold mb-2">📝 Transcript</h2>
        <div className="text-gray-200 whitespace-pre-wrap break-words h-40 overflow-y-auto">
          {transcript}
          {interimTranscript && (
            <span className="italic text-gray-400">{interimTranscript}</span>
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* Chat Section */}
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md">
        <h2 className="text-2xl font-bold mb-4">💬 Chat</h2>
        <div className="h-40 bg-white/5 rounded-lg overflow-y-auto p-3 mb-4 text-sm text-gray-200 border border-white/10">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`mb-2 ${msg.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
              <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong> {msg.content}
            </div>
          ))}
        </div>
        <form onSubmit={handleChatSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Type your message..."
            value={chatInput}
            onChange={handleChatInput}
            disabled={!isConnected}
            className="flex-1 bg-white/10 text-white placeholder-gray-400 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isConnected || !chatInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 transition px-5 py-2 rounded-lg font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;