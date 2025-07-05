import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant, RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';

const SERVER_URL = 'http://localhost:5001';

const Audio = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState('');
  // const [sessionId, ]
  const [token, setToken] = useState('');
  const [room, setRoom] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState(null);
  const [isMicOn, setIsMicOn] = useState(false);
  const audioRef = useRef(null);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [editingPrompt, setEditingPrompt] = useState('');
  const [isPromptEditing, setIsPromptEditing] = useState(false);
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


  const handlePhoneChange = (e) => {
    setSelectedPhone(e.target.value);
  };

  // 1. Create room and get token
  const handleConnect = async () => {
    try {
      setError(null);

      // 1. Create a unique room name (or let user pick)
      const newRoomName = 'room-' + Math.random().toString(36).substring(2, 10);
      setRoomName(newRoomName);

      // 2. Ask server to create room and join agent
      const roomCreation = await fetch(`${SERVER_URL}/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: newRoomName, userData: selectedPhone })
      });
      const prompt = await roomCreation.json();
      console.log(prompt.prompt)
      setCurrentPrompt(prompt.prompt);
      setEditingPrompt(prompt.prompt)

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
      setIsMicOn(false);
      setIsConnected(false);

    }
  };

  // 3. Send chat message
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!room || !chatInput.trim()) return;
    const response = await fetch(`${SERVER_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: roomName, message: chatInput })
    })
    console.log()
    const result = await response.json();
    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    if (result.response) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: result.response }]);
    }
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

    try {
      if (!isMicOn) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTrack = stream.getAudioTracks()[0];
        await room.localParticipant.publishTrack(audioTrack);
        setIsMicOn(true);
      } else {
        // Get all audio tracks and unpublish them
        room.localParticipant.audioTracks.forEach(publication => {
          // publication.unPublishTrack();
          // Stop the actual media track to release the microphone
          publication.track?.stop();
        });
        setIsMicOn(false);
      }
    } catch (error) {
      console.error('Error toggling microphone:', error);
      // Handle error appropriately (show user notification, etc.)
    }
  };

  const handlePromptSave = async () => {
    const res = await fetch(`${SERVER_URL}/change-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userData: selectedPhone, prompt: editingPrompt, tools: selectedFunction })
    })
    const result = await res.json();
  }

  const handleFunctionInput = (e) => {
    const { value, checked } = e.target;
    // const val = availableFunction.find(value);
    console.log(availableFunction[value]);
    setSelectedFunction(prev =>
      checked ? [...prev, availableFunction[value]] : prev.filter(func => func !== availableFunction[value])
    );
    // console.log(selectedFunction)
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (room) room.disconnect();
    };
  }, [room]);

  return (
    <div className="min-h-screen bg-black from-gray-900 to-gray-800 text-white p-6 flex flex-col justify-center items-center align-center">
      {
        !isConnected ? (
          <div className="p-6 max-w-md mx-auto bg-black rounded-lg shadow-md">
            <div className="mb-4">
              <select
                id="phone-select"
                value={selectedPhone}
                onChange={handlePhoneChange}
                className="w-full px-3 py-2 bg-black border border-gray-600 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-white focus:border-white"
              >
                {/* <option value="">-- Please select --</option> */}
                <option value="" className="bg-black text-white">Unknown</option>
                <option value="+919313562780" className="bg-black text-white">Shubhanshu</option>
                <option value="+918780899485" className="bg-black text-white">Abhinav</option>
              </select>
            </div>

            {selectedPhone && (
              <div className="mt-4 p-3 bg-gray-900 rounded-md">
                <p className="text-sm text-white">
                  Selected: <span className="font-semibold">{
                    selectedPhone === '+919313562780' ? 'Shubhanshu' :
                      selectedPhone === '+918780899485' ? 'Abhinav' :
                        'Unknown'
                  }</span>
                </p>
              </div>
            )}
          </div>
        ) : ""
      }
      <header className="mb-6 text-center">
        {/* <h1 className="text-3xl font-extrabold">Voice Agent</h1> */}
        {roomName && <p className="text-xs text-gray-200 mt-1">Room: {roomName}</p>}
      </header>
      <div className="flex flex-wrap gap-4 mb-6 justify-center">
        {!isConnected ? (
          <button onClick={handleConnect} className="bg-white text-black hover:bg-gray-300 cursor-pointer transition px-6 py-2 rounded-full font-semibold shadow">Connect</button>
        ) : (
          <button onClick={handleDisconnect} className="bg-white text-black cursor-pointer hover:bg-gray-300 transition px-6 py-2 rounded-full font-semibold shadow">Disconnect</button>
        )}
        {isConnected && (
          <button onClick={handleMicToggle} className={`transition px-6 cursor-pointer py-2 rounded-full font-semibold shadow ${isMicOn ? 'bg-white text-black hover:bg-gray-300' : 'bg-black text-white border-2 hover:bg-gray-900'}`}>{isMicOn ? '🎤 Stop Mic' : '🎤 Start Mic'}</button>
        )}
      </div>
      {error && <div className="text-red-300 text-sm mb-4">{error}</div>}
      <audio ref={audioRef} autoPlay />




      {/* Prompt Box */}
      {
        isConnected && selectedPhone ? (<div className="bg-white/10 w-full backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
          <h2 className="text-2xl font-bold mb-2">Prompt</h2>
          <textarea className="text-gray-200 whitespace-pre-wrap break-words min-h-fit h-200 max-h-400 w-full overflow-y-auto" onChange={((e) => { setEditingPrompt(e.target.value) })} value={editingPrompt} />
          <div className=' text-3xl'>
            Function Available to use
            <div className='flex justify-between text-xl items-center'>
              {
                availableFunction.map((func, index) => {
                  // console.log("function",index)
                  // let fun = `${func}`
                  console.log(selectedFunction.includes(func))
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

          <button onClick={handlePromptSave} className='w-30 h-8 bg-blue-600 text-white rounded-2xl mt-10 p-1'>EditingPrompt</button>
        </div>) : ""
      }


      {/* <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
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
      </div> */}
    </div>
  );
};

export default Audio;