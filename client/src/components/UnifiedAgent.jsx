import { useEffect, useRef, useState } from 'react';
import { Settings, MessageCircle, Copy, Check, User, Bot, Search, X, Loader2, Mic, MicOff, PhoneCall, PhoneOff } from 'lucide-react';
import { Room, RoomEvent } from 'livekit-client';
import { AVAILABLE_FUNCTIONS } from '../utils/tools';
import Select from 'react-select';

const SERVER_URL = 'https://call-server.shipfast.studio/livekit';
const LIVEKIT_URL = 'wss://aiagent-i9rqezpr.livekit.cloud';

// Minimal country list with flags and dialing codes
const COUNTRIES = [
    { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳' },
    { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸' },
    { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
    { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦' },
    { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺' },
    { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪' },
    { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷' },
    { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸' },
    { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹' },
    { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱' },
    { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬' },
    { code: 'AE', name: 'UAE', dial: '+971', flag: '🇦🇪' },
];

const options = COUNTRIES.map(c => ({
    value: c.code,
    label: (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className={`fi fi-${c.code.toLowerCase()}`} style={{ marginRight: 8 }}></span>
            {`(${c.dial})`}
        </div>
    ),
}));

// Dark theme styles for react-select
const selectDarkStyles = {
    control: (base, state) => ({
        ...base,
        minHeight: 40,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderColor: 'rgba(255,255,255,0.1)',
        boxShadow: state.isFocused ? '0 0 0 2px rgba(59,130,246,0.5)' : 'none',
        ':hover': {
            borderColor: 'rgba(255,255,255,0.2)'
        },
        cursor: 'pointer'
    }),
    valueContainer: (base) => ({
        ...base,
        padding: '0 8px',
        color: '#fff'
    }),
    singleValue: (base) => ({
        ...base,
        color: '#fff'
    }),
    input: (base) => ({
        ...base,
        color: '#fff'
    }),
    placeholder: (base) => ({
        ...base,
        color: '#9ca3af'
    }),
    dropdownIndicator: (base) => ({
        ...base,
        color: '#9ca3af'
    }),
    indicatorSeparator: () => ({ display: 'none' }),
    menu: (base) => ({
        ...base,
        backgroundColor: '#0b0b0b',
        border: '1px solid rgba(255,255,255,0.1)',
        zIndex: 9999,
        width: '100%'
    }),
    option: (base, state) => ({
        ...base,
        backgroundColor: state.isFocused ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: '#e5e7eb',
        cursor: 'pointer'
    }),
    menuPortal: (base) => ({ ...base, zIndex: 9999 })
};

const UnifiedAgent = () => {
    // shared pre-connect state
    const [selectedPhone, setSelectedPhone] = useState('');
    const [editingPrompt, setEditingPrompt] = useState('You are a Helpful assistant');
    const [selectedFunction, setSelectedFunction] = useState([]);
    const [mode, setMode] = useState(null); // 'audio' | 'chat'
    const [step, setStep] = useState('config'); // 'config' | 'session'

    // connection state
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);

    // audio-specific state
    const [roomName, setRoomName] = useState('');
    const [room, setRoom] = useState(null);
    const [isMicOn, setIsMicOn] = useState(false);
    const audioRef = useRef(null);
    const audioCtxRef = useRef(null);
    const analyserRef = useRef(null);
    const rafRef = useRef(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [callInput, setCallInput] = useState('');
    const [isCalling, setIsCalling] = useState(false);
    const [countryCode, setCountryCode] = useState('IN');

    // chat-specific state
    const wsRef = useRef(null);
    const [sessionId, setSessionId] = useState(null);
    const chatEndRef = useRef(null);
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [toolFilter, setToolFilter] = useState('');
    const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'tools'

    useEffect(() => {
        return () => {
            if (room) room.disconnect();
            if (wsRef.current) wsRef.current.close();
        };
    }, [room]);

    // Load persisted config on first mount
    useEffect(() => {
        try {
            const storedUser = localStorage.getItem('agent.selectedPhone');
            const storedPrompt = localStorage.getItem('agent.prompt');
            const storedTools = localStorage.getItem('agent.tools');
            if (storedUser) setSelectedPhone(storedUser);
            if (storedPrompt) setEditingPrompt(storedPrompt);
            if (storedTools) {
                const names = JSON.parse(storedTools);
                const restored = AVAILABLE_FUNCTIONS.filter(f => names.includes(f.name));
                if (restored.length) setSelectedFunction(restored);
            }
        } catch {
            // ignore
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist config on change
    useEffect(() => {
        try {
            localStorage.setItem('agent.selectedPhone', selectedPhone || '');
            localStorage.setItem('agent.prompt', editingPrompt || '');
            localStorage.setItem('agent.tools', JSON.stringify(selectedFunction.map(f => f.name)));
        } catch {
            // ignore
        }
    }, [selectedPhone, editingPrompt, selectedFunction]);

    const handleFunctionInput = (e) => {
        const { value, checked } = e.target;
        const fn = AVAILABLE_FUNCTIONS[Number(value)];
        setSelectedFunction((prev) => (checked ? [...prev, fn] : prev.filter((f) => f !== fn)));
    };

    const handleCallInput = (e) => {
        setCallInput(e.target.value);
    };

    const handleCall = async () => {
        if (!callInput.trim() || isCalling) return;
        try {
            setIsCalling(true);
            const selected = COUNTRIES.find(c => c.code === countryCode) || COUNTRIES[0];
            const raw = callInput.trim().replace(/\s|-/g, '');
            const fullNumber = raw.startsWith('+') ? raw : `${selected.dial}${raw.replace(/^0+/, '')}`;
            const response = await fetch('https://temp-vb4k.onrender.com/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: fullNumber })
            });
            // ignore response body; best-effort trigger
            try { await response.json(); } catch { }
            setCallInput('');
        } catch {
            // ignore errors for now
        } finally {
            setIsCalling(false);
        }
    };

    const joinAudio = async () => {
        setIsLoading(true);
        await connectAudio();
        setIsLoading(false);
        setMode('audio');
        setStep('session');
    };

    const joinChat = async () => {
        setIsLoading(true);
        await connectChat();
        setIsLoading(false);
        setMode('chat');
        setStep('session');
    };

    // Audio connect
    const connectAudio = async () => {
        try {
            if (isLoading) return;
            setIsLoading(true);
            setError(null);

            const newRoomName = 'room-' + Math.random().toString(36).substring(2, 10);
            setRoomName(newRoomName);

            const roomCreation = await fetch(`${SERVER_URL}/create-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomName: newRoomName,
                    userData: selectedPhone,
                    prompt: editingPrompt,
                    tool: selectedFunction,
                    participantName: 'user-' + Math.random().toString(36).substring(2, 8),
                }),
            });
            if (!roomCreation.ok) {
                const errorText = await roomCreation.text();
                throw new Error(`create-room failed (${roomCreation.status}): ${errorText}`);
            }
            const payload = await roomCreation.json();
            if (!payload?.token) {
                throw new Error('No LiveKit token received from server');
            }

            const livekitRoom = new Room();
            await livekitRoom.connect(LIVEKIT_URL, payload.token, { autoSubscribe: true });
            setRoom(livekitRoom);
            setIsConnected(true);
            setIsLoading(false);

            livekitRoom.on(RoomEvent.DataReceived, handleDataReceived);
            livekitRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
            livekitRoom.on(RoomEvent.Disconnected, () => {
                setIsConnected(false);
                setRoom(null);
                setIsMicOn(false);
            });
        } catch (err) {
            console.error(err);
            setError('Failed to connect: ' + (err?.message || 'Unknown error'));
            setIsLoading(false);
        } finally {
            // no-op, handled above
        }
    };

    // Chat connect
    const connectChat = async () => {
        try {
            setError(null);
            wsRef.current = new WebSocket('wss://call-server.shipfast.studio/websocketchat/');

            wsRef.current.onopen = () => {
                wsRef.current.send(
                    JSON.stringify({
                        type: 'start_session',
                        event: 'start',
                        userData: selectedPhone,
                        prompt: editingPrompt,
                        tools: selectedFunction,
                    }),
                );
            };

            wsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    setIsConnected(true);
                    if (data.type === 'session_started') {
                        setSessionId(data.sessionId);
                        setIsLoading(false);
                    } else if (data.type === 'text' || data.type === 'text_response') {
                        setChatMessages((prev) => [...prev, { role: 'assistant', content: data.media?.payload ?? '' }]);
                    } else if (data.type === 'current_prompt') {
                        setEditingPrompt(data.prompt);
                    } else if (data.error) {
                        setError(data.error);
                        setIsLoading(false);
                    }
                } catch (err) {
                    setError('Error parsing server response');
                    setIsLoading(false);
                }
            };

            wsRef.current.onerror = (e) => {
                console.error('WebSocket error', e);
                setError('WebSocket connection error');
                setIsLoading(false);
            };
            wsRef.current.onclose = () => {
                setIsConnected(false);
                setSessionId(null);
                setIsLoading(false);
            };
        } catch (err) {
            console.error(err);
            setError('Failed to connect to server: ' + (err?.message || 'Unknown error'));
        }
    };

    const handleDataReceived = (payload, participant) => {
        try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'chat') {
                setChatMessages((prev) => [
                    ...prev,
                    { role: participant.identity === room.localParticipant.identity ? 'user' : 'assistant', content: msg.content },
                ]);
            }
        } catch { }
    };

    const handleTrackSubscribed = (track, publication, participant) => {
        if (track.kind === 'audio') {
            track.attach(audioRef.current);
            const el = audioRef.current;
            const trySetup = () => {
                const stream = el?.srcObject;
                if (stream instanceof MediaStream) {
                    if (rafRef.current) {
                        cancelAnimationFrame(rafRef.current);
                        rafRef.current = null;
                    }
                    setIsSpeaking(false);
                    setupAmbientDetection(stream);
                }
            };
            if (el?.srcObject) {
                trySetup();
            } else {
                el?.addEventListener('loadedmetadata', trySetup, { once: true });
                el?.addEventListener('playing', trySetup, { once: true });
            }
        }
    };

    const setupAmbientDetection = (audioEl) => {
        try {
            if (!audioEl) return;
            if (!audioCtxRef.current) {
                audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }

            const ctx = audioCtxRef.current;
            // Keep analyser state unique per setup
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.85;
            analyserRef.current = analyser;

            // Prefer connecting the underlying MediaStream to the analyser
            const source = ctx.createMediaStreamSource(audioEl);
            source.connect(analyser);

            const data = new Uint8Array(analyser.fftSize);
            // Hysteresis thresholds using RMS on time-domain signal
            const speakOn = 4;  // increase to be less sensitive
            const speakOff = 2;  // lower than speakOn to avoid flicker
            let speaking = false;
            let aboveCount = 0;
            let belowCount = 0;

            const tick = () => {
                analyser.getByteTimeDomainData(data);
                // Compute RMS of AC component centered around 128
                let sumSquares = 0;
                for (let i = 0; i < data.length; i++) {
                    const centered = data[i] - 128;
                    sumSquares += centered * centered;
                }
                const rms = Math.sqrt(sumSquares / data.length);
                const level = (rms / 128) * 100; // approx 0-100 scale

                if (level > speakOn) {
                    aboveCount += 1;
                    belowCount = 0;
                } else if (level < speakOff) {
                    belowCount += 1;
                    aboveCount = 0;
                }

                const minFrames = 3;
                if (!speaking && aboveCount >= minFrames) {
                    speaking = true;
                    setIsSpeaking(true);
                } else if (speaking && belowCount >= minFrames + 2) {
                    speaking = false;
                    setIsSpeaking(false);
                }

                rafRef.current = requestAnimationFrame(tick);
            };
            // Always start a new loop for a fresh stream
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => { });
            }
            rafRef.current = requestAnimationFrame(tick);
        } catch (e) {
            // ignore analyser setup failures
        }
    };

    const handleMicToggle = async () => {
        if (!room) return;
        try {
            const localParticipant = room.localParticipant;
            const currentState = localParticipant.isMicrophoneEnabled;
            await localParticipant.setMicrophoneEnabled(!currentState);
            setIsMicOn(!currentState);
        } catch (error) {
            const actualState = room.localParticipant.isMicrophoneEnabled;
            setIsMicOn(actualState);
        }
    };

    const handleDisconnect = () => {
        if (room) {
            room.disconnect();
        }
        if (wsRef.current) {
            wsRef.current.close();
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (audioCtxRef.current) {
            try { audioCtxRef.current.close(); } catch { }
            audioCtxRef.current = null;
        }
        analyserRef.current = null;
        setIsSpeaking(false);
        setIsConnected(false);
        setSessionId(null);
        setMode(null);
        setStep('config');
        setChatMessages([]);
    };

    const handleChatSubmit = (e) => {
        e?.preventDefault?.();
        if (!chatInput.trim()) return;
        if (mode === 'chat') {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            setChatMessages((prev) => [...prev, { role: 'user', content: chatInput }]);
            wsRef.current.send(
                JSON.stringify({ event: 'media', type: 'chat', media: { payload: chatInput } }),
            );
            setChatInput('');
        } else if (mode === 'audio') {
            // send chat via REST to server for audio mode
            fetch(`${SERVER_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName: roomName, message: chatInput }),
            })
                .then((res) => res.json())
                .then((result) => {
                    setChatMessages((prev) => [...prev, { role: 'user', content: chatInput }]);
                    if (result.response) {
                        setChatMessages((prev) => [...prev, { role: 'assistant', content: result.response }]);
                    }
                })
                .finally(() => setChatInput(''));
        }
    };

    // auto-scroll chat to bottom on new message
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const copyMessage = async (text, index) => {
        try {
            await navigator.clipboard.writeText(text || '');
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 1200);
        } catch {
            // ignore copy failures
        }
    };

    // UI
    if (step === 'config') {
        const samplePrompts = [
            'You are a Helpful assistant',
            'You are a Friendly assistant. Keep answers short and clear.',
            'You are a professional support agent. Ask clarifying questions.',
            'You are a Shopify order assistant. Help with order status and cancellations.',
        ];

        const filteredFunctions = AVAILABLE_FUNCTIONS.filter((f) =>
            f.name.toLowerCase().includes(toolFilter.toLowerCase()) ||
            (f.description || '').toLowerCase().includes(toolFilter.toLowerCase())
        );

        const isAllSelected = filteredFunctions.length > 0 && filteredFunctions.every((f) => selectedFunction.includes(f));
        const toggleAllFunctions = () => {
            if (isAllSelected) {
                setSelectedFunction(prev => prev.filter(f => !filteredFunctions.includes(f)));
            } else {
                setSelectedFunction(prev => {
                    const set = new Set(prev);
                    filteredFunctions.forEach(f => set.add(f));
                    return Array.from(set);
                });
            }
        };

        const removeSelectedTool = (tool) => {
            setSelectedFunction(prev => prev.filter(f => f !== tool));
        };

        return (
            <div className="min-h-screen min-w-screen bg-black text-white px-4 py-6 justify-center flex items-start md:items-center">
                <div className="mx-auto w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left hero (desktop) */}
                    <div className="hidden md:flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-8">
                        <div className="orb-float mb-6">
                            <img src="/Ai Image.png" alt="AI Orb" className="orb-img" />
                        </div>
                        <h2 className="text-2xl font-semibold">Design your agent</h2>
                        <p className="mt-2 text-sm text-gray-400 text-center">
                            Choose the user, craft the system prompt, and enable the tools you need. Then join via audio or chat.
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
                            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Real‑time audio</span>
                            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Function calling</span>
                            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Context prompts</span>
                        </div>
                    </div>

                    {/* Hero (mobile) */}
                    <div className="flex md:hidden flex-col items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-6">
                        <div className="orb-float mb-4">
                            <img src="/Ai Image.png" alt="AI Orb" className="orb-img" />
                        </div>
                        <h2 className="text-lg font-semibold">Design your agent</h2>
                        <p className="mt-1 text-xs text-gray-400 text-center">
                            Choose the user, craft the system prompt, and enable the tools you need.
                        </p>
                    </div>

                    {/* Right: tabbed config card */}
                    <div className="relative rounded-2xl border border-white/10 bg-white/5 p-6">
                        {isLoading && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-black/40">
                                <div className="flex items-center gap-3 text-gray-200">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span className="text-sm">Preparing session…</span>
                                </div>
                            </div>
                        )}
                        {/* Tabs */}
                        <div className="flex items-center gap-2 text-sm mb-4">
                            <button
                                onClick={() => setActiveTab('basic')}
                                className={`px-3 py-1.5 rounded-lg border ${activeTab === 'basic' ? 'bg-blue-600 border-blue-500' : 'bg-black/40 border-white/10'} hover:bg-white/10`}
                                type="button"
                            >
                                Basics
                            </button>
                            <button
                                onClick={() => setActiveTab('tools')}
                                className={`px-3 py-1.5 rounded-lg border ${activeTab === 'tools' ? 'bg-blue-600 border-blue-500' : 'bg-black/40 border-white/10'} hover:bg-white/10`}
                                type="button"
                            >
                                Tools
                            </button>
                        </div>

                        {/* Basics */}
                        {activeTab === 'basic' && (
                            <div className="space-y-5">
                                <div>
                                    <div className="text-sm font-medium text-gray-300 mb-2">User</div>
                                    <select
                                        value={selectedPhone}
                                        onChange={(e) => setSelectedPhone(e.target.value)}
                                        className="w-full px-3 py-2 bg-black/60 border border-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="" className="bg-black text-white">Unknown</option>
                                        <option value="+919313562780" className="bg-black text-white">Shubhanshu</option>
                                        <option value="+919512467691" className="bg-black text-white">Ankit C</option>
                                        <option value="+918780899485" className="bg-black text-white">Abhinav</option>
                                    </select>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-medium text-gray-300">System Prompt</div>
                                        <div className="text-xs text-gray-500">{editingPrompt.length} chars</div>
                                    </div>
                                    <textarea
                                        value={editingPrompt}
                                        onChange={(e) => setEditingPrompt(e.target.value)}
                                        placeholder="Enter your system prompt here..."
                                        className="w-full text-sm h-32 p-3 bg-black/60 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {samplePrompts.map((sp, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setEditingPrompt(sp)}
                                                className="text-xs px-3 py-1 text-left rounded-full bg-white/10 hover:bg-white/20 border border-white/10"
                                                type="button"
                                            >
                                                {sp}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Join cards */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                    <button
                                        onClick={joinAudio}
                                        disabled={isLoading}
                                        className="group rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 p-4 text-left disabled:opacity-60"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-lg p-2 bg-white/10 border border-white/10">
                                                <Mic className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Join via Audio</div>
                                                <div className="text-xs text-gray-400">Real-time voice with LiveKit</div>
                                            </div>
                                        </div>
                                    </button>
                                    <button
                                        onClick={joinChat}
                                        disabled={isLoading}
                                        className="group rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 p-4 text-left disabled:opacity-60"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-lg p-2 bg-white/10 border border-white/10">
                                                <MessageCircle className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">Join via Chat</div>
                                                <div className="text-xs text-gray-400">WebSocket text conversation</div>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                                {/* Phone call inline input */}
                                <div className="mt-3 grid grid-cols-2 gap-2 items-stretch sm:flex sm:flex-row">
                                    <div className='flex justify-center items-center w-full flex-wrap col-span-2 space-x-2'>
                                        <Select
                                            options={options}
                                            aria-label="Country code"
                                            value={options.find(o => o.value === countryCode)}
                                            onChange={(opt) => setCountryCode(opt?.value || 'IN')}
                                            className="w-[41%] sm:w-auto sm:min-w-[8rem]"
                                            classNamePrefix="country"
                                            isSearchable={false}
                                            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                                            styles={selectDarkStyles}
                                            menuPlacement="auto"
                                            menuPosition="fixed"
                                            menuShouldScrollIntoView
                                        />
                                        <input
                                            type="tel"
                                            inputMode="tel"
                                            value={callInput}
                                            onChange={handleCallInput}
                                            placeholder="Enter phone number"
                                            className="w-[56%] sm:flex-1 min-w-0 px-3 py-2 bg-black/60 border border-white/10 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                                        />
                                    </div>
                                    <button
                                        onClick={handleCall}
                                        disabled={!callInput.trim() || isCalling}
                                        className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed w-full sm:w-auto col-span-2"
                                        type="button"
                                    >
                                        <PhoneCall className="w-4 h-4" />
                                        Call
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Tools */}
                        {activeTab === 'tools' && (
                            <div>
                                <div className="mb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium text-gray-300">Available Functions</div>
                                        <span className="hidden sm:inline text-xs text-gray-400">{selectedFunction.length} selected</span>
                                    </div>
                                    <div className="mt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                        <div className="relative flex-1">
                                            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-2.5" />
                                            <input
                                                value={toolFilter}
                                                onChange={(e) => setToolFilter(e.target.value)}
                                                placeholder="Search tools"
                                                className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-black/60 border border-white/10 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between sm:justify-start gap-2 text-xs text-gray-400">
                                            <span className="sm:hidden">{selectedFunction.length} selected</span>
                                            <button onClick={toggleAllFunctions} className="px-3 py-1 rounded-full bg-black/60 border border-white/10 hover:bg-black/40 w-fit sm:w-auto">
                                                {isAllSelected ? 'Clear all' : 'Select all'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {selectedFunction.length > 0 && (
                                    <div className="mb-3 flex flex-wrap gap-2">
                                        {selectedFunction.map((tool) => (
                                            <span key={tool.name} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300">
                                                {tool.name}
                                                <button onClick={() => removeSelectedTool(tool)} className="hover:text-white" title="Remove">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {filteredFunctions.map((func, index) => {
                                        const checked = selectedFunction.includes(func);
                                        return (
                                            <label key={index} className={`group cursor-pointer rounded-lg border p-3 transition-colors ${checked ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/10 bg-black/40'} hover:bg-white/10`}>
                                                <div className="flex items-start gap-3">
                                                    <input
                                                        type="checkbox"
                                                        value={AVAILABLE_FUNCTIONS.indexOf(func)}
                                                        onChange={handleFunctionInput}
                                                        checked={checked}
                                                        className="mt-1 w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
                                                    />
                                                    <div>
                                                        <div className="font-medium text-gray-200">{func.name}</div>
                                                        {func.description && (
                                                            <div className="text-xs text-gray-400 mt-1">{func.description}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Session layout
    if (mode === 'audio') {
        return (
            <div className="min-h-screen min-w-screen bg-black text-white p-6 flex flex-col items-center justify-center gap-6">
                {/* <div className="text-2xl font-bold">Audio Call</div> */}
                <div className={`orb-float ${isSpeaking ? "orb-speaking" : ""}`}>
                    <img src="/Ai Image.png" alt="AI Orb" />
                </div>
                <audio ref={audioRef} autoPlay />
                <div className="flex items-center gap-3 px-4 sm:px-0">
                    <button
                        onClick={handleMicToggle}
                        title={isMicOn ? 'Start mic' : 'Mute mic'}
                        className={`h-12 w-12 rounded-full flex items-center justify-center shadow transition-colors ${isMicOn
                            ? 'bg-gray-800 text-gray-100 hover:bg-gray-700'
                            : 'bg-red-900/20 border border-red-800/40 text-red-400 hover:bg-red-900/30'
                            }`}
                    >
                        {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={handleDisconnect}
                        title="End call"
                        className="h-12 px-6 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow"
                    >
                        <PhoneOff className="w-5 h-5" />
                    </button>
                </div>
            </div>
        );
    }

    // Chat-only layout (ChatGPT-like)
    return (
        <div className="min-h-screen min-w-screen bg-black text-white flex flex-col">
            <header className="sticky top-0 z-10 px-4 py-3 border-b border-white/10 bg-black/80 backdrop-blur flex items-center justify-center gap-2">
                <MessageCircle className="w-5 h-5 text-gray-300" />
                <div className="text-sm font-semibold tracking-wide text-gray-200">Chat</div>
            </header>

            <main className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-4 py-6">
                    {chatMessages.length === 0 ? (
                        <div className="text-center text-gray-400 mt-16">Start a conversation. Press Enter to send, Shift+Enter for a new line.</div>
                    ) : (
                        chatMessages.map((msg, index) => {
                            const isUser = msg.role === 'user';
                            return (
                                <div key={index} className={`mb-5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                    {!isUser && (
                                        <div className="mr-3 mt-1 h-fit shrink-0 rounded-full bg-white/5 border border-white/10 p-2">
                                            <Bot className="w-4 h-4 text-purple-300" />
                                        </div>
                                    )}
                                    <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 leading-relaxed text-sm shadow ${isUser ? 'bg-blue-600 text-white' : 'bg-white/5 border border-white/10 text-gray-100'
                                        }`}>
                                        {msg.content}
                                        {!isUser && (
                                            <div className="mt-2 flex justify-end">
                                                <button
                                                    onClick={() => copyMessage(msg.content, index)}
                                                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
                                                    title="Copy"
                                                >
                                                    {copiedIndex === index ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                    <span>{copiedIndex === index ? 'Copied' : 'Copy'}</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {isUser && (
                                        <div className="ml-3 mt-1 h-fit shrink-0 rounded-full bg-blue-600/20 border border-blue-500/30 p-2">
                                            <User className="w-4 h-4 text-blue-300" />
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                    <div ref={chatEndRef} />
                </div>
            </main>

            <footer className="sticky bottom-0 px-4 py-4 bg-black/80 backdrop-blur border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-3xl">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                        <textarea
                            rows={1}
                            placeholder="Message..."
                            value={chatInput}
                            onChange={(e) => {
                                const el = e.target;
                                el.style.height = 'auto';
                                el.style.height = Math.min(el.scrollHeight, 200) + 'px';
                                setChatInput(e.target.value);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleChatSubmit(e);
                                }
                            }}
                            disabled={!isConnected}
                            className="flex-1 max-h-[200px] overflow-hidden resize-none bg-white/5 border border-white/10 text-white placeholder-gray-400 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        />
                        <button
                            onClick={handleChatSubmit}
                            disabled={!isConnected || !chatInput.trim()}
                            className="h-11 w-full sm:w-auto shrink-0 px-5 rounded-xl font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed"
                        >
                            Send
                        </button>
                        <button
                            onClick={handleDisconnect}
                            className="h-11 w-full sm:w-auto shrink-0 px-5 rounded-xl font-semibold bg-white text-black hover:bg-gray-300"
                        >
                            Disconnect
                        </button>
                    </div>
                    <div className="mt-2 text-center text-xs text-gray-500">Press Enter to send • Shift+Enter for newline</div>
                </div>
            </footer>
        </div>
    );
};

export default UnifiedAgent;


