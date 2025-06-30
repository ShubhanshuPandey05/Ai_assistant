import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant, RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';

const SERVER_URL = 'http://localhost:5001';

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [token, setToken] = useState('');
  const [room, setRoom] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState(null);
  const [isMicOn, setIsMicOn] = useState(false);
  const audioRef = useRef(null);

  // 1. Create room and get token
  const handleConnect = async () => {
    try {
      setError(null);
      // 1. Create a unique room name (or let user pick)
      const newRoomName = 'room-' + Math.random().toString(36).substring(2, 10);
      setRoomName(newRoomName);
      // 2. Ask server to create room and join agent
      await fetch(`${SERVER_URL}/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: newRoomName })
      });
      // 3. Get token for this user
      const resp = await fetch(`${SERVER_URL}/get-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: newRoomName, participantName: 'user-' + Math.random().toString(36).substring(2, 8) })
      });
      const data = await resp.json();
      setToken(data.token);

      const livekitRoom = new Room();
      // 4. Connect to LiveKit room
      await livekitRoom.connect('wss://aiagent-i9rqezpr.livekit.cloud', data.token, {
        autoSubscribe: true
      });
      setRoom(livekitRoom);
      setIsConnected(true);
      // 5. Setup event listeners
      livekitRoom.on(RoomEvent.DataReceived, handleDataReceived);
      livekitRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      livekitRoom.on(RoomEvent.Disconnected, () => {
        setIsConnected(false);
        setRoom(null);
      });
    } catch (err) {
      setError('Failed to connect: ' + err.message);
    }
  };

  // 2. Disconnect
  const handleDisconnect = () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setIsConnected(false);
    }
  };

  // 3. Send chat message
  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!room || !chatInput.trim()) return;

    // console.log(chatInput)

    const data = JSON.stringify({ type: 'chat', content: chatInput })
    console.log(data)
    room.localParticipant.sendChatMessage(
      {
        text : data
      }
    );
    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    setChatInput('');
  };

  // 4. Receive chat message
  const handleDataReceived = (payload, participant, kind) => {
    try {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      if (msg.type === 'chat') {
        setChatMessages(prev => [...prev, { role: participant.identity === room.localParticipant.identity ? 'user' : 'assistant', content: msg.content }]);
      }
      // Handle other message types (e.g., transcript, interim, etc.)
    } catch (err) {
      // ignore
    }
  };

  // 5. Handle remote audio
  const handleTrackSubscribed = (track, publication, participant) => {
    if (track.kind === 'audio') {
      // Play remote audio
      track.attach(audioRef.current);
    }
  };

  // 6. Publish mic audio
  const handleMicToggle = async () => {
    if (!room) return;
    if (!isMicOn) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await room.localParticipant.publishTrack(stream.getAudioTracks()[0]);
      setIsMicOn(true);
    } else {
      room.localParticipant.audioTracks.forEach(pub => pub.unpublish());
      setIsMicOn(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (room) room.disconnect();
    };
  }, [room]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6">
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-wide">🎙️ Voice Agent Dashboard (LiveKit)</h1>
        {roomName && <p className="text-xs text-blue-400 mt-1">Room: {roomName}</p>}
      </header>
      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        {!isConnected ? (
          <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 transition px-6 py-2 rounded-full font-semibold shadow">🔌 Connect</button>
        ) : (
          <button onClick={handleDisconnect} className="bg-red-600 hover:bg-red-700 transition px-6 py-2 rounded-full font-semibold shadow">🔌 Disconnect</button>
        )}
        {isConnected && (
          <button onClick={handleMicToggle} className={`transition px-6 py-2 rounded-full font-semibold shadow ${isMicOn ? 'bg-yellow-600' : 'bg-green-600'}`}>{isMicOn ? '🎤 Stop Mic' : '🎤 Start Mic'}</button>
        )}
      </div>
      {error && <div className="text-red-300 text-sm mb-4">{error}</div>}
      <audio ref={audioRef} autoPlay />
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
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
            onChange={e => setChatInput(e.target.value)}
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