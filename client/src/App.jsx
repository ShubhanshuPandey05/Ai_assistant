import { useEffect, useRef, useState } from 'react';
import { Room, createLocalAudioTrack } from 'livekit-client';
import { RoomEvent, Track } from 'livekit-client';
// import { createLocalAudioTrack } from 'livekit-client';

const LIVEKIT_URL = 'wss://aiagent-i9rqezpr.livekit.cloud';

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [editingPrompt, setEditingPrompt] = useState('');
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [roomName, setRoomName] = useState('ai-assistant-room');
  const [userName, setUserName] = useState(`user-${Date.now()}`);
  const [availableFunction, setAvailableFunction] = useState([
    {
      type: "function",
      name: "getAllProducts",
      description: "Get a list of all products in the store.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      type: "function",
      name: "getUserDetailsByPhoneNo",
      description: "Get customer details",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      type: "function",
      name: "getAllOrders",
      description: "Get a list of all orders.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      type: "function",
      name: "getOrderById",
      description: "Get details for a specific order by its ID.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "The Shopify order ID." }
        },
        required: ["orderId"]
      }
    }
  ]);
  const [selectedFunction, setSelectedFunction] = useState([]);
  const transcriptEndRef = useRef(null);
  const localTrackRef = useRef(null);
  const [latency, setLatency] = useState({ llm: 0, stt: 0, tts: 0 });
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const [aiSessionId, setAiSessionId] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);

  // Connect to LiveKit room
  const connect = async () => {
    if (!roomName.trim() || !userName) {
      alert('Please enter both room name and user name');
      return;
    }
  
    setIsConnecting(true);
    setConnectionStatus('Creating room and AI session...');
    setError(null); // Clear any previous errors
  
    try {
      // Step 1: Call API to create room and AI session
      const response = await fetch('http://localhost:3001/api/livekit-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          room: roomName,
          identity: userName,
        }),
      });
  
      if (!response.ok) {
        throw new Error('Failed to create room and AI session');
      }
  
      const data = await response.json();
      console.log('Room and AI session created:', data);
  
      setConnectionStatus('AI session established. Connecting to room...');
      setAiSessionId(data.aiSessionId);
  
      // Step 2: Connect to LiveKit room
      const token = data.token;
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
  
      // Event handlers
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log('Participant connected:', participant.identity);
        setParticipants(prev => [...prev, participant]);
      });
  
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('Participant disconnected:', participant.identity);
        setParticipants(prev => prev.filter(p => p.identity !== participant.identity));
      });
  
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log('Track subscribed:', track.kind, 'from', participant.identity);

        console.log("track : ",track)
        if (track.kind === Track.Kind.Audio) {
          const audioElement = document.createElement('audio');
          audioElement.autoplay = true;
          track.attach(audioElement);
          document.body.appendChild(audioElement);
          console.log('Audio element attached to DOM for participant:', participant.identity);
        }
      });
  
      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        console.log('Track unsubscribed:', track.kind, 'from', participant.identity);
        // Clean up audio elements if needed
      });
  
      room.on(RoomEvent.Connected, () => {
        console.log('Connected to room');
        setConnectionStatus('Connected! AI assistant is ready.');
        setIsConnected(true);
        setIsConnecting(false);
      });
  
      room.on(RoomEvent.Disconnected, () => {
        console.log('Disconnected from room');
        setConnectionStatus('Disconnected from room');
        setIsConnected(false);
        setIsConnecting(false);
      });
  
      setCurrentRoom(room);
  
      // Connect to the room first
      await room.connect('wss://aiagent-i9rqezpr.livekit.cloud', token);
      console.log('Connected to LiveKit room');
  
      // Step 3: Enable local audio after connection
      try {
        setConnectionStatus('Connected! Requesting microphone access...');
        
        const audioTrack = await createLocalAudioTrack({
          // Optional: specify audio constraints
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        
        console.log('Local audio track created:', audioTrack);
        
        // Publish the audio track
        const publication = await room.localParticipant.publishTrack(audioTrack);
        console.log('Local audio track published:', publication);
        
        setConnectionStatus('Connected! Microphone active - AI assistant is ready.');
        
      } catch (audioError) {
        console.error('Audio setup error:', audioError);
        setConnectionStatus('Connected! But microphone access failed - AI can hear you but you may not hear responses.');
        // Continue without audio - room is still connected
      }
  
    } catch (error) {
      console.error('Connection error:', error);
      setConnectionStatus(`Connection failed: ${error.message}`);
      setIsConnecting(false);
      setError(`Connection failed: ${error.message}`);
      
      // Cleanup on failure
      if (currentRoom) {
        currentRoom.disconnect();
        setCurrentRoom(null);
      }
    }
  };

  // Disconnect from LiveKit room
  const disconnectLiveKit = async () => {
    if (currentRoom) {
      currentRoom.disconnect();
      setCurrentRoom(null);
    }
    setIsConnected(false);
    setParticipants([]);
    setIsPublishing(false);
    setAiSessionId('');
    setConnectionStatus('Disconnected');
  };

  // Publish local audio
  const startPublishing = async () => {
    if (!currentRoom) return;
    try {
      const audioTrack = await createLocalAudioTrack({
        // Optional: specify audio constraints
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      
      await currentRoom.localParticipant.publishTrack(audioTrack);
      localTrackRef.current = audioTrack;
      setIsPublishing(true);
      console.log('🎤 Started publishing audio');
    } catch (err) {
      console.error('Failed to publish audio:', err);
      setError('Failed to publish audio: ' + err.message);
    }
  };

  // Stop publishing local audio
  const stopPublishing = async () => {
    if (currentRoom && localTrackRef.current) {
      try {
        await currentRoom.localParticipant.unpublishTrack(localTrackRef.current);
        localTrackRef.current.stop();
        localTrackRef.current = null;
        setIsPublishing(false);
        console.log('🔇 Stopped publishing audio');
      } catch (err) {
        console.error('Failed to stop publishing audio:', err);
        setError('Failed to stop publishing audio: ' + err.message);
      }
    }
  };

  // Handle participant changes
  function handleParticipantChange() {
    if (currentRoom) {
      setParticipants(Array.from(currentRoom.participants.values()));
    }
  }

  // Handle remote track subscription
  function handleTrackSubscribed(track, publication, participant) {
    if (track.kind === 'audio') {
      // Attach remote audio to output
      const audio = track.attach();
      audio.play();
      setIsPlaying(true);
      console.log(`🔊 Playing audio from: ${participant.identity}`);
    }
  }

  // Handle remote track unsubscription
  function handleTrackUnsubscribed(track, publication, participant) {
    if (track.kind === 'audio') {
      track.detach();
      setIsPlaying(false);
      console.log(`🔇 Stopped playing audio from: ${participant.identity}`);
    }
  }

  // Handle data messages (for chat)
  function handleDataReceived(payload, participant) {
    try {
      const data = JSON.parse(payload);
      if (data.type === 'chat') {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message
        }]);
      }
    } catch (error) {
      console.error('Error parsing data message:', error);
    }
  }

  // Send chat message
  const sendChatMessage = async (message) => {
    if (!currentRoom || !message.trim()) return;

    try {
      const chatData = {
        type: 'chat',
        message: message
      };

      await currentRoom.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(chatData)),
        { topic: 'chat' }
      );

      setChatMessages(prev => [...prev, {
        role: 'user',
        content: message
      }]);

      setChatInput('');
    } catch (error) {
      console.error('Error sending chat message:', error);
      setError('Failed to send chat message: ' + error.message);
    }
  };

  // Handle chat submit
  const handleChatSubmit = (e) => {
    e.preventDefault();
    sendChatMessage(chatInput);
  };

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

  const handleChatInput = (e) => {
    setChatInput(e.target.value);
    // Clear error when user starts typing
    if (error) setError(null);
  };

  const handlePromptSave = () => {
    // Placeholder: Implement prompt save logic with LiveKit data channel or backend
    setCurrentPrompt(editingPrompt);
    setIsPromptEditing(false);
  };

  const handlePromptCancel = () => {
    setEditingPrompt(currentPrompt);
    setIsPromptEditing(false);
  };

  const handleFunctionInput = (e) => {
    const { value, checked } = e.target;
    setSelectedFunction(prev =>
      checked ? [...prev, availableFunction[value]] : prev.filter(func => func !== availableFunction[value])
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6">
      {/* Header */}
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-wide">🎙️ Voice Agent Dashboard (LiveKit)</h1>
        <p className="text-sm text-gray-400 mt-1">LiveKit WebRTC Audio Streaming</p>
        <p className="text-xs text-blue-400 mt-1">Room: {roomName}</p>
      </header>

      {/* Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Connection</p>
          <div className={`mt-1 text-lg font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {connectionStatus}
          </div>
          {error && <div className="mt-2 text-red-300 text-sm">{error}</div>}
          {isPlaying && <div className="mt-2 text-blue-300 text-sm">Playing AI audio...</div>}
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
            {isPublishing ? 'Publishing Audio' : 'Audio Off'}
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

        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">AI Session</p>
          <div className="mt-2 space-y-1">
            {aiSessionId ? (
              <p className="text-xs text-green-400 break-all">{aiSessionId}</p>
            ) : (
              <p className="text-xs text-gray-400">Not connected</p>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        {!isConnected ? (
          <>
            {/* Room and User Input Fields */}
            <div className="flex flex-wrap gap-4 mb-4 w-full justify-center">
              <div className="flex flex-col">
                <label className="text-sm text-gray-300 mb-1">Room Name:</label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => {
                    setRoomName(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter room name"
                  className="bg-white/10 text-white placeholder-gray-400 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 border border-white/20"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-sm text-gray-300 mb-1">User Name:</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => {
                    setUserName(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter your name"
                  className="bg-white/10 text-white placeholder-gray-400 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 border border-white/20"
                />
              </div>
            </div>

            <button
              onClick={connect}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-700 transition px-6 py-2 rounded-full font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? '🔄 Connecting...' : '🔌 Connect to Room'}
            </button>
          </>
        ) : (
          <button
            onClick={disconnectLiveKit}
            className="bg-red-600 hover:bg-red-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            🔌 Disconnect
          </button>
        )}

        {isConnected && !isPublishing && (
          <button
            onClick={startPublishing}
            className="bg-green-600 hover:bg-green-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            🎙️ Start Talking
          </button>
        )}
        {isConnected && isPublishing && (
          <button
            onClick={stopPublishing}
            className="bg-yellow-600 hover:bg-yellow-700 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            🔇 Stop Talking
          </button>
        )}
      </div>

      {/* Prompt Box */}
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
        <h2 className="text-2xl font-bold mb-2">📝 Prompt</h2>
        <textarea className="text-gray-200 whitespace-pre-wrap break-words min-h-fit h-200 max-h-400 w-full overflow-y-auto" onChange={((e) => { setEditingPrompt(e.target.value) })} value={editingPrompt} />
        <div className='text-red-500 text-3xl'>
          Function Available to use
          <div className='flex justify-between text-xl items-center'>
            {
              availableFunction.map((func, index) => {
                return (
                  <div key={index} className='p-2'>
                    <input
                      type="checkbox"
                      value={index}
                      name="funcs"
                      className='m-2 w-5'
                      onChange={handleFunctionInput}
                      checked={selectedFunction.includes(func)}
                    />
                    {func.name}
                  </div>
                )
              })
            }
          </div>
        </div>

        <button onClick={handlePromptSave} className='w-30 h-8 bg-blue-600 text-white rounded-2xl mt-10 p-1'>Save Prompt</button>
      </div>

      {/* Chat Section */}
      <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md">
        <h2 className="text-2xl font-bold mb-4">💬 Chat</h2>
        <div className="h-40 bg-white/5 rounded-lg overflow-y-auto p-3 mb-4 text-sm text-gray-200 border border-white/10">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`mb-2 ${msg.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
              <strong>{msg.role === 'user' ? 'You' : 'AI Assistant'}:</strong> {msg.content}
            </div>
          ))}
          <div ref={transcriptEndRef} />
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
    </div >
  );
};

export default App;