import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';

const WebSocketAudio = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [streamSid, setStreamSid] = useState('');
  const [status, setStatus] = useState('Disconnected');

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const audioBufferRef = useRef([]);

  // Audio format constants for 8kHz μ-law
  const SAMPLE_RATE = 44100;
  const BUFFER_SIZE = 512; // Buffer size (64ms at 8kHz)
  const CHUNK_SIZE = 400; // Target chunk size for sending (50ms at 8kHz)

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

  // Generate random stream SID
  const generateStreamSid = () => {
    return 'MZ' + Math.random().toString(36).substr(2, 32);
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    wsRef.current = new WebSocket('ws://127.0.0.1:5001');

    wsRef.current.onopen = () => {
      setIsConnected(true);
      setStatus('Connected');
      const sid = generateStreamSid();
      setStreamSid(sid);

      // Send start event with streamSID
      wsRef.current.send(JSON.stringify({
        event: 'start',
        streamSid: sid
      }));

      console.log('WebSocket connected, sent start event with streamSid:', sid);
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'media' && data.media?.payload) {
          playAudioFromServer(data.media.payload);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
      setStatus('Disconnected');
      stopRecording();
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('Connection Error');
    };
  };

  // Play audio received from server
  const playAudioFromServer = async (base64Payload) => {
    try {
      const binaryData = atob(base64Payload);
      const audioData = new Uint8Array(binaryData.length);

      for (let i = 0; i < binaryData.length; i++) {
        audioData[i] = binaryData.charCodeAt(i);
      }

      // Decode μ-law to PCM
      const pcmData = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        pcmData[i] = decodeMuLaw(audioData[i]);
      }

      // Create audio context if not exists
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Create audio buffer
      const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 8000);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0; // Convert to float [-1, 1]
      }

      // Play the audio
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.start();

    } catch (error) {
      console.error('Error playing audio from server:', error);
    }
  };

  // Start recording audio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      streamRef.current = stream;

      // Create audio context
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);

      // Create script processor for audio processing
      processorRef.current = audioContextRef.current.createScriptProcessor(BUFFER_SIZE, 1, 1);

      processorRef.current.onaudioprocess = (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputBuffer = event.inputBuffer.getChannelData(0);

          // Downsample from 44100 to 8000 Hz
          const downsampledBuffer = downsampleBuffer(inputBuffer, 44100, 8000);

          // Add to buffer and continue with existing logic...
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

            // Send to server
            wsRef.current.send(JSON.stringify({
              event: 'media',
              streamSid: streamSid,
              media: { payload: base64 }
            }));
          }
        }
      };

      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      setIsRecording(true);
      setStatus('Recording and Streaming');

    } catch (error) {
      console.error('Error starting recording:', error);
      setStatus('Microphone Error');
    }
  };

  // Stop recording
  const stopRecording = () => {
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

    setIsRecording(false);
    audioBufferRef.current = []; // Clear audio buffer
    if (isConnected) {
      setStatus('Connected');
    }
  };

  // Disconnect WebSocket
  const disconnect = () => {
    stopRecording();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setStreamSid('');
    setStatus('Disconnected');
  };


  // Downsample from input sample rate (e.g., 44100) to 8000
  const downsampleBuffer = (buffer, inputSampleRate, outputSampleRate = 8000) => {
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const origin = Math.floor(i * sampleRateRatio);
      result[i] = buffer[origin];
    }
    return result;
  };


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-center mb-6">WebSocket Audio Stream</h2>

      <div className="space-y-4">
        {/* Status */}
        <div className="text-center">
          <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
            {status}
          </div>
        </div>

        {/* Stream SID */}
        {streamSid && (
          <div className="text-center text-sm text-gray-600">
            <div className="font-medium">Stream ID:</div>
            <div className="font-mono text-xs break-all">{streamSid}</div>
          </div>
        )}

        {/* Connection Controls */}
        <div className="flex justify-center space-x-4">
          {!isConnected ? (
            <button
              onClick={connectWebSocket}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Phone size={20} />
              <span>Connect</span>
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center space-x-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              <PhoneOff size={20} />
              <span>Disconnect</span>
            </button>
          )}
        </div>

        {/* Recording Controls */}
        {isConnected && (
          <div className="flex justify-center">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <Mic size={20} />
                <span>Start Recording</span>
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center space-x-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors animate-pulse"
              >
                <MicOff size={20} />
                <span>Stop Recording</span>
              </button>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
          <div className="font-medium mb-1">Instructions:</div>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click "Connect" to establish WebSocket connection</li>
            <li>Click "Start Recording" to begin streaming audio</li>
            <li>Audio will be encoded as 8kHz μ-law and sent every 50ms to server</li>
            <li>Received audio from server will be played automatically</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default WebSocketAudio;