import { useEffect, useRef, useState } from 'react';
import { Room, Participant, RemoteTrackPublication, RemoteAudioTrack, createLocalAudioTrack, connect } from '@livekit/client';

const LIVEKIT_URL = 'wss://your-livekit-server-url'; // TODO: Replace with your LiveKit server URL
const PLACEHOLDER_TOKEN = 'YOUR_PLACEHOLDER_TOKEN'; // TODO: Replace with a real token from backend

const LiveKitVoiceAgent = () => {
  const [room, setRoom] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const transcriptEndRef = useRef(null);
  const localTrackRef = useRef(null);

  // Connect to LiveKit room
  const connectLiveKit = async () => {
    setError(null);
    try {
      const newRoom = new Room();
      setRoom(newRoom);
      await connect(newRoom, LIVEKIT_URL, PLACEHOLDER_TOKEN);
      setIsConnected(true);
      // Listen for participant events
      newRoom.on('participantConnected', handleParticipantChange);
      newRoom.on('participantDisconnected', handleParticipantChange);
      newRoom.on('trackSubscribed', handleTrackSubscribed);
      newRoom.on('trackUnsubscribed', handleTrackUnsubscribed);
      setParticipants(Array.from(newRoom.participants.values()));
    } catch (err) {
      setError('Failed to connect to LiveKit: ' + err.message);
      setIsConnected(false);
    }
  };

  // Disconnect from LiveKit room
  const disconnectLiveKit = async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setIsConnected(false);
      setParticipants([]);
      setIsPublishing(false);
    }
  };

  // Publish local audio
  const startPublishing = async () => {
    if (!room) return;
    try {
      const localTrack = await createLocalAudioTrack();
      localTrackRef.current = localTrack;
      await room.localParticipant.publishTrack(localTrack);
      setIsPublishing(true);
    } catch (err) {
      setError('Failed to publish audio: ' + err.message);
    }
  };

  // Stop publishing local audio
  const stopPublishing = async () => {
    if (room && localTrackRef.current) {
      await room.localParticipant.unpublishTrack(localTrackRef.current);
      localTrackRef.current.stop();
      localTrackRef.current = null;
      setIsPublishing(false);
    }
  };

  // Handle participant changes
  function handleParticipantChange() {
    if (room) {
      setParticipants(Array.from(room.participants.values()));
    }
  }

  // Handle remote track subscription
  function handleTrackSubscribed(track, publication, participant) {
    if (track.kind === 'audio') {
      // Attach remote audio to output
      const audio = track.attach();
      audio.play();
      setIsPlaying(true);
    }
  }

  // Handle remote track unsubscription
  function handleTrackUnsubscribed(track, publication, participant) {
    if (track.kind === 'audio') {
      track.detach();
      setIsPlaying(false);
    }
  }

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectLiveKit();
    };
    // eslint-disable-next-line
  }, []);

  // UI rendering
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6">
      {/* Header */}
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-wide">🎙️ Voice Agent Dashboard (LiveKit)</h1>
        <p className="text-sm text-gray-400 mt-1">LiveKit WebRTC Audio Streaming</p>
      </header>

      {/* Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Connection</p>
          <div className={`mt-1 text-lg font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          {error && <div className="mt-2 text-red-300 text-sm">{error}</div>}
          {isPlaying && <div className="mt-2 text-blue-300 text-sm">Playing remote audio...</div>}
        </div>

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300 mb-1">Audio Level</p>
          <div className="w-full bg-gray-600 h-3 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${isPublishing ? 'bg-green-500' : 'bg-gray-300'}`}
              style={{ width: `${audioLevel}%` }}
            ></div>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            LiveKit Audio
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Participants</p>
          <div className="mt-2 space-y-1">
            <p><span className="text-gray-400">You</span></p>
            {participants.map((p) => (
              <p key={p.identity}><span className="text-gray-400">Remote:</span> {p.identity}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        {!isConnected ? (
          <button
            onClick={connectLiveKit}
            className="bg-blue-600 hover:bg-blue-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={disconnectLiveKit}
            className="bg-red-600 hover:bg-red-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            Disconnect
          </button>
        )}

        {isConnected && !isPublishing && (
          <button
            onClick={startPublishing}
            className="bg-green-600 hover:bg-green-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            🎙️ Start Publishing
          </button>
        )}
        {isConnected && isPublishing && (
          <button
            onClick={stopPublishing}
            className="bg-yellow-600 hover:bg-yellow-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            ⏹ Stop Publishing
          </button>
        )}
      </div>

      {/* Chat Section (disabled for now) */}
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md">
        <h2 className="text-2xl font-bold mb-4">💬 Chat (Coming Soon)</h2>
        <div className="h-40 bg-white/5 rounded-lg overflow-y-auto p-3 mb-4 text-sm text-gray-200 border border-white/10">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`mb-2 ${msg.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
              <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong> {msg.content}
            </div>
          ))}
        </div>
        <form onSubmit={e => e.preventDefault()} className="flex gap-2">
          <input
            type="text"
            placeholder="Type your message... (disabled)"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            disabled
            className="flex-1 bg-white/10 text-white placeholder-gray-400 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled
            className="bg-blue-600 hover:bg-blue-700 transition px-5 py-2 rounded-lg font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

export default LiveKitVoiceAgent;