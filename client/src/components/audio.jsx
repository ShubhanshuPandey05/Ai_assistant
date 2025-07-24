import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant, RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';
import { Settings, Check, Phone, PhoneCall } from 'lucide-react';

const SERVER_URL = 'http://localhost:5001';
// const SERVER_URL = 'https://call-server.shipfast.studio/livekit';

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
  const [currentPrompt, setCurrentPrompt] = useState(`You are an AI assistant for ecommerce store. 
**Process:**
1. Understand user intent
2. Use tools if you need store data (products, orders, customers)
3. Respond in JSON format:
{
"response": "your answer here",
"output_channel": "audio"
}`);
  const [editingPrompt, setEditingPrompt] = useState(`You are an AI assistant for ecommerce store. 
**Process:**
1. Understand user intent
2. Use tools if you need store data (products, orders, customers)
3. Respond in JSON format:
{
"response": "your answer here",
"output_channel": "audio"
}`);
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
  const [callInput, setCallInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [pageIndex, setPageIndex] = useState(0);
  const pages = 2; // update if you add more pages
  let isScrolling = false;

  useEffect(() => {
    const handleWheel = (e) => {
      if (isScrolling) return;

      if (e.deltaY > 0 && pageIndex < pages - 1) {
        setPageIndex((prev) => prev + 1);
        isScrolling = true;
      } else if (e.deltaY < 0 && pageIndex > 0) {
        setPageIndex((prev) => prev - 1);
        isScrolling = true;
      }

      setTimeout(() => {
        isScrolling = false;
      }, 800); // wait for scroll to finish
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [pageIndex]);

  useEffect(() => {
    window.scrollTo({
      top: pageIndex * window.innerHeight,
      behavior: "smooth",
    });
  }, [pageIndex]);

  const handleCallInput = (e) => {
    setCallInput(e.target.value);
  };

  const handleCall = async () => {
    // const callInput = '+1234567890'; // Replace with the recipient's number
    try {
      setIsLoading(true);
      const response = await fetch('https://temp-vb4k.onrender.com/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: callInput })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error from server:', errorText);
        return;
      }

      const data = await response.json(); // only if server sends JSON
      console.log('Response:', data);
      setSelectedPhone('');
      setIsLoading(false);
    } catch (error) {
      console.error('Fetch error:', error.message);
      setIsLoading(false);
    }
  };



  const handlePhoneChange = (e) => {
    setSelectedPhone(e.target.value);
  };

  // 1. Create room and get token
  const handleConnect = async () => {
    try {
      if (!isLoading) {
        setIsLoading(true);
        setError(null);

        // 1. Create a unique room name (or let user pick)
        const newRoomName = 'room-' + Math.random().toString(36).substring(2, 10);
        setRoomName(newRoomName);


        console.log({
          roomName: newRoomName,
          userData: selectedPhone,
          prompt: editingPrompt,
          tool: selectedFunction
        })

        // 2. Ask server to create room and join agent
        const roomCreation = await fetch(`${SERVER_URL}/create-room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: newRoomName, userData: selectedPhone, prompt: editingPrompt, tool: selectedFunction, participantName: 'user-' + Math.random().toString(36).substring(2, 8) })
        });
        const prompt = await roomCreation.json();
        console.log(prompt.prompt)
        setCurrentPrompt(prompt.prompt);
        setEditingPrompt(prompt.prompt)

        setToken(prompt.token);

        const livekitRoom = new Room();

        // 4. Connect to LiveKit room
        await livekitRoom.connect('wss://aiagent-i9rqezpr.livekit.cloud', prompt.token, {
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
      }
    } catch (err) {
      console.log(err)
      setError('Failed to connect: ' + err.message);
    } finally {
      setIsLoading(false);
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
      const localParticipant = room.localParticipant;
      const currentState = localParticipant.isMicrophoneEnabled;

      // Toggle the microphone
      await localParticipant.setMicrophoneEnabled(!currentState);

      // Update local state to match LiveKit's state
      setIsMicOn(!currentState);

    } catch (error) {
      console.error('Error toggling microphone:', error);

      // Sync state with actual LiveKit state on error
      const actualState = room.localParticipant.isMicrophoneEnabled;
      setIsMicOn(actualState);
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
    <div className="min-h-screen min-w-screen bg-black from-gray-900 to-gray-800 text-white flex md:flex-row flex-col justify-center items-center align-center overflow-y-hidden container">
      <div className='w-full md:w-1/2 h-screen border-r-0 md:border-r-2 border-b-1 md:border-b-0 border-white p-5 md:p-8 overflow-y-auto page'>
        <div className='text-2xl font-bold text-center'>Make a Web Call</div>
        {
          !isConnected ? (
            <div className="p-6 max-w-md mx-auto bg-black rounded-lg shadow-md">
              <div className='text-xl font-bold mb-4'>Select a User</div>
              <div className="">
                <select
                  id="phone-select"
                  value={selectedPhone}
                  onChange={handlePhoneChange}
                  className="w-full px-3 py-2 bg-black border border-gray-600 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-white focus:border-white"
                >
                  {/* <option value="">-- Please select --</option> */}
                  <option value="" className="bg-black text-white">Unknown</option>
                  <option value="+919313562780" className="bg-black text-white">Shubhanshu</option>
                  <option value="+919512467691" className="bg-black text-white">Ankit C</option>
                  <option value="+918780899485" className="bg-black text-white">Abhinav</option>
                </select>
              </div>

              {selectedPhone && (
                <div className="mt-4 p-3 bg-gray-900 rounded-md">
                  <p className="text-sm text-white">
                    Selected: <span className="font-semibold">{
                      selectedPhone === '+919313562780' ? 'Shubhanshu' :
                        selectedPhone === '+918780899485' ? 'Abhinav' :
                          selectedPhone === '+919512467691' ? 'Ankit C' :
                            'Unknown'
                    }</span>
                  </p>
                </div>
              )}
            </div>
          ) : ""
        }
        <header className="mb-2 text-center">
          {/* <h1 className="text-3xl font-extrabold">Voice Agent</h1> */}
          {roomName && <p className="text-xs text-gray-200 mt-1">Room: {roomName}</p>}
        </header>
        <div className="flex flex-wrap gap-4 mb-6 justify-center">
          {!isConnected ? (
            <button onClick={handleConnect} disabled={isLoading} className="bg-white text-black hover:bg-gray-300 cursor-pointer transition px-6 py-2 rounded-full font-semibold shadow">{isLoading ? 'Connecting...' : 'Connect'}</button>
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
          !isConnected ? (<div className="max-w-4xl mx-auto bg-black rounded-lg shadow-xl border border-gray-700 p-6 mb-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <Settings className="w-6 h-6 text-blue-600" />
              <h2 className="md:text-2xl text-xl font-semibold text-white">Prompt Configuration</h2>
            </div>

            {/* Prompt Editor */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-300 mb-3">
                System Prompt
              </label>
              <textarea
                value={editingPrompt}
                onChange={(e) => setEditingPrompt(e.target.value)}
                placeholder="Enter your system prompt here..."
                className="w-full text-xs md:text-base h-32 p-4 bg-gray-800 border border-gray-600 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-100 placeholder-gray-500"
              />
            </div>

            {/* Function Selection */}
            <div className="text-xs md:text-base">
              <label className="block text-sm font-medium text-gray-300 mb-4">
                Available Functions
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {availableFunction.map((func, index) => (
                  <label
                    key={index}
                    className="flex items-center p-3 border border-gray-600 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      value={index}
                      onChange={handleFunctionInput}
                      checked={selectedFunction.includes(func)}
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                    />
                    <span className="ml-3 text-gray-300 font-medium">{func.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Action Button */}
            {/* <div className="flex justify-end">
              <button
                onClick={handlePromptSave}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <Check className="w-4 h-4" />
                Save Configuration
              </button>
            </div> */}
          </div>) : ""
        }
      </div>

      <div className='w-full md:w-1/2 h-screen md:border-l-2 border-l-0 border-white p-5 md:p-8 overflow-hidden page'>
        <div className='text-2xl font-bold mb-4 text-center'>Make a Phone Call</div>
        {/* Call Box */}
        {
          !isConnected ? (
            <div className="flex flex-col items-center justify-center h-full space-y-6">
              {/* Phone Call Section */}
              <div className="mx-auto w-full bg-black rounded-lg shadow-xl border border-gray-700 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Phone className="w-5 h-5 text-blue-400" />
                  <h3 className="text-lg font-semibold text-white">Make a Call</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      placeholder="Enter phone number"
                      value={callInput}
                      onChange={handleCallInput}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <button
                    onClick={handleCall}
                    disabled={!callInput.trim() || isLoading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Calling...
                      </>
                    ) : (
                      <>
                        <PhoneCall className="w-4 h-4" />
                        Call Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : ""
        }
      </div>
    </div>

  );
};

export default Audio;