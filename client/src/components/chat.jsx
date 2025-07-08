import { useEffect, useRef, useState } from 'react';
// const SERVER_URL = 'http://localhost:5001';
const SERVER_URL = 'https://call-server.shipfast.studio/livekit';


const Chat = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
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

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const handlePhoneChange = (e) => {
    setSelectedPhone(e.target.value);
  };

  const cleanup = () => {
    if (wsRef.current && sessionId) {
      // Send stop session message before closing
      // wsRef.current.send(JSON.stringify({
      //   type: 'stop_session',
      //   sessionId: sessionId
      // }));
      wsRef.current.close();
    }
  };

  const handleChatSubmit = (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    setChatMessages(prev => [...prev, { role: 'user', content: chatInput }]);
    console.log('Sending chat message:', chatInput);

    wsRef.current.send(JSON.stringify({
      event: 'media',
      type: 'chat',
      media: { payload: chatInput }
    }));
    setChatInput('');
  };

  const handleChatInput = (e) => {
    setChatInput(e.target.value);
  };

  const connectToServer = async () => {
    try {
      setError(null);

      // Connect to WebSocket
      // wsRef.current = new WebSocket('ws://localhost:5002');
      wsRef.current = new WebSocket('wss://call-server.shipfast.studio/websocket/');

      wsRef.current.onopen = () => {
        console.log('WebSocket connected, starting session...');

        // Initialize session with the server
        wsRef.current.send(JSON.stringify({
          type: 'start_session',
          event: 'start',
          userData: selectedPhone
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          setIsConnected(true);
          if (data.type === 'session_started') {
            // Session initialized successfully
            setSessionId(data.sessionId);
            setIsConnected(true);
            console.log('Session started with ID:', data.sessionId);

          } else if (data.type === 'text' || data.type === 'text_response') {
            console.log('Text response:', data.media.payload);
            setChatMessages(prev => [...prev, { role: 'assistant', content: data.media.payload }]);

          }
          else if (data.type === 'current_prompt') {
            // console.log('Current prompt received:', data.prompt);
            // console.log(data)
            // setAvailableFunction(data.functions)
            setCurrentPrompt(data.prompt);
            setEditingPrompt(data.prompt);

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
      };

    } catch (err) {
      setError('Failed to connect to server: ' + err.message);
      console.error('Error connecting to server:', err);
    }
  };

  const disconnect = () => {
    window.location.reload();
    cleanup();
    setIsConnected(false);
    setSessionId(null);
  };

  const clearChat = () => {
    setChatMessages([]);
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

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col space-y-5 justify-center items-center align-center">
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
      {/* Header */}
      {/* <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-wide">Chat</h1>
        <p className="text-sm text-gray-400 mt-1">Connect & Chat</p>
        {sessionId && (
          <p className="text-xs text-blue-400 mt-1">Session: {sessionId}</p>
        )}
      </header> */}

      {/* Status Card
      <div className="grid grid-cols-1 md:grid-cols-1 gap-6 mb-6">
        <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-md">
          <p className="text-sm text-gray-300">Connection</p>
          <div className={`mt-1 text-lg font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          {error && <div className="mt-2 text-red-300 text-sm">{error}</div>}
        </div>
      </div> */}

      {/* Controls */}
      <div className="gap-4 mb-6">
        {isConnected ? (
          <div>
            <button
              onClick={disconnect}
              className="bg-white cursor-pointer hover:bg-gray-300 text-black w-32 transition px-6 py-2 rounded-full font-semibold shadow"
            >
              Disconnect
            </button>
            <button
              onClick={clearChat}
              className="bg-black hover:bg-gray-900 border-2 cursor-pointer w-32 transition px-6 py-2 rounded-full font-semibold shadow"
            >
              Clear
            </button>
          </div>
        ) : (
          <button
            onClick={connectToServer}
            className="bg-white cursor-pointer text-black hover:bg-gray-300 w-32 transition px-6 py-2 rounded-full font-semibold shadow"
          >
            Connect
          </button>
        )}
      </div>

      {/* Chat Section */}
      {
        isConnected ? (
          <div className="bg-white/10 backdrop-blur-md p-6 w-100 rounded-xl border border-white/20 shadow-md">
            <h2 className="text-2xl font-bold mb-4">Chat</h2>
            <div className="h-96 bg-white/5 rounded-lg overflow-y-auto p-3 mb-4 text-sm text-gray-200 border border-white/10">
              {chatMessages.length === 0 ? (
                <div className="text-gray-400 text-center mt-8">No messages yet. Start a conversation!</div>
              ) : (
                chatMessages.map((msg, index) => (
                  <div key={index} className={`mb-3 ${msg.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
                    <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong> {msg.content}
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type your message..."
                value={chatInput}
                onChange={handleChatInput}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit(e);
                  }
                }}
                disabled={!isConnected}
                className="flex-1 bg-white/10 text-white placeholder-gray-400 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                onClick={handleChatSubmit}
                disabled={!isConnected || !chatInput.trim()}
                className="bg-blue-600 hover:bg-blue-700 transition px-5 py-2 rounded-lg font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        ) : ""
      }



      {/* Prompt Box */}
      {
        isConnected&&selectedPhone ? (<div className="bg-white/10 w-full backdrop-blur-md p-6 rounded-xl border border-white/20 shadow-md mb-6">
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
    </div>
  );
};

export default Chat;