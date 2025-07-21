import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, DataPacket_Kind, RemoteParticipant, RemoteTrackPublication, RemoteAudioTrack } from 'livekit-client';
import { Settings, Check, Phone, PhoneCall, Mic } from 'lucide-react';

// const SERVER_URL = 'http://localhost:5001';
const SERVER_URL = 'https://call-server.shipfast.studio/livekit';

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
    const [currentPrompt, setCurrentPrompt] = useState(`You are an AI assistant for "Gautam Garment" Shopify store. 
**Process:**
1. Understand user intent
2. Use tools if you need store data (products, orders, customers)
3. Respond in JSON format:
{
"response": "your answer here",
"output_channel": "audio"
}`);
    const [editingPrompt, setEditingPrompt] = useState(`You are an AI assistant for "Gautam Garment" Shopify store. 
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
                body: JSON.stringify({ roomName: newRoomName, userData: selectedPhone, prompt: editingPrompt, tool: selectedFunction })
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
            console.log(err)
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
                setTimeout(() => {
                    // handleCall()
                    setIsMicOn(true);
                }, 3000)
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
        <div className="min-w-screen min-h-screen bg-black from-gray-900 to-gray-800 text-white flex md:flex-row flex-col justify-center items-center align-center overflow-y-hidden">
            <div className='w-full md:w-[80%] h-screen border-r-0 md:border-r border-gray-700 border-b-1 md:border-b-0 p-5 md:p-8 overflow-y-auto page'>
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
                                style={{
                                    /* Webkit scrollbar styles */
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#3b82f6 rgba(65, 72, 79, 0)',
                                }}
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
            <div className='w-full md:w-[20%] h-screen border-r-0 border-b-1 md:border-b-0 border-white overflow-y-auto page'>
                <div className="flex h-full flex-wrap gap-4 justify-center items-center">
                    {!isConnected ? (
                        <div className='flex flex-col justify-center items-center space-y-5'>
                            <div className='text-lg text-gray-400 font-bold text-center'>Test Multi Agent</div>
                            <button onClick={handleConnect} className="bg-white text-black hover:bg-gray-300 cursor-pointer flex space-x-2 transition px-6 py-2 rounded-full font-semibold shadow"><Mic className='w-5' /> <p>Connect</p></button>
                        </div>
                    ) : (
                        <button onClick={handleDisconnect} className="bg-white text-black cursor-pointer hover:bg-gray-300 transition px-6 py-2 rounded-full font-semibold shadow">Disconnect</button>
                    )}
                    {isConnected && (
                        <button onClick={handleMicToggle} className={`transition px-6 cursor-pointer py-2 rounded-full font-semibold shadow ${isMicOn ? 'bg-white text-black hover:bg-gray-300' : 'bg-black text-white border-2 hover:bg-gray-900'}`}>{isMicOn ? '🎤 Stop Mic' : '🎤 Start Mic'}</button>
                    )}
                </div>
                {error && <div className="text-red-300 text-sm mb-4">{error}</div>}
                <audio ref={audioRef} autoPlay />
            </div>
        </div>

    );
};

export default Audio;