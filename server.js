// Core Dependencies
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const OpenAI = require("openai");
const twilio = require('twilio');
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-01/graphql.json`;
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Transform } = require('stream');
const WebSocket = require('ws');
const { createClient, LiveTTSEvents } = require('@deepgram/sdk');
const deepgramTts = createClient(process.env.DEEPGRAM_API);

// LiveKit imports
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room, RoomEvent, RemoteParticipant, LocalParticipant, AudioPresets, VideoPresets, TrackSource, AudioSource, LocalAudioTrack, AudioFrame, TrackKind, AudioStream } = require('@livekit/rtc-node');
const NC = require('@livekit/noise-cancellation-node');

const PROTO_PATH = './turn.proto';

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const turnProto = grpc.loadPackageDefinition(packageDefinition).turn;

const turnDetector = new turnProto.TurnDetector(
    'localhost:50051',
    grpc.credentials.createInsecure()
);

const FRAME_SMP = 480;
const FRAME_BYTES = FRAME_SMP * 2;

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const toolDefinitions = [
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
];

function detectTurnEnd(currentText, options = {}) {
    // Configuration with defaults
    const config = {
        minLength: options.minLength || 2,
        silenceThreshold: options.silenceThreshold || 800, // ms
        punctuationWeight: options.punctuationWeight || 0.5,
        questionWeight: options.questionWeight || 0.7,
        statementWeight: options.statementWeight || 0.4,
        ...options
    };

    // Early return for very short or empty text
    if (!currentText || currentText.trim().length < config.minLength) {
        return false;
    }

    const text = currentText.trim();
    let score = 0;

    // 1. Definitive sentence endings (high confidence)
    const definitiveEndings = /[.!]\s*$/;
    if (definitiveEndings.test(text)) {
        score += 0.9;
    }

    // 2. Question completion patterns (very strong indicator)
    const questionPatterns = [
        /\?\s*$/,  // Direct question mark
        /^(what|how|why|when|where|who|which|can|could|would|should|do|does|did|is|are|was|were)\b.*[?.]?\s*$/i,
        /\b(right|okay|ok)\?\s*$/i,
        /\b(you know|understand|make sense)\?\s*$/i
    ];

    if (questionPatterns.some(pattern => pattern.test(text))) {
        score += config.questionWeight;
    }

    // 3. Natural completion phrases (strong indicators)
    const completionPhrases = [
        /\b(that's it|that's all|done|finished|complete)\b/i,
        /\b(thank you|thanks|bye|goodbye|see you)\b/i,
        /\b(anyway|anyhow|well|so|ok|okay|alright)\s*[.!]?\s*$/i,
        /\b(never mind|forget it|doesn't matter)\b/i
    ];

    if (completionPhrases.some(pattern => pattern.test(text))) {
        score += 0.8;
    }

    // 4. Response completion patterns
    const responsePatterns = [
        /\b(yes|no|sure|okay|alright|exactly|correct|right)\s*[.!]?\s*$/i,
        /\b(I think|I believe|I guess|I suppose)\b.*[.!]\s*$/i,
        /\b(maybe|probably|perhaps|possibly)\s*[.!]?\s*$/i
    ];

    if (responsePatterns.some(pattern => pattern.test(text))) {
        score += 0.6;
    }

    // 5. Incomplete patterns (reduce score - indicates ongoing speech)
    const incompletePatterns = [
        /\b(and|but|or|so|because|since|although|while|if|when|where|that|which)\s*$/i,
        /,\s*$/,  // Ends with comma
        /\b(the|a|an)\s*$/i,  // Ends with articles
        /\b(in|on|at|by|for|with|to|from)\s*$/i,  // Ends with prepositions
        /\b(I'm|I am|I was|I will|I have|I had)\s*$/i,  // Incomplete statements
        /\b(going to|want to|need to|have to)\s*$/i,  // Incomplete actions
        /\b(kind of|sort of|type of)\s*$/i  // Incomplete descriptions
    ];

    if (incompletePatterns.some(pattern => pattern.test(text))) {
        score -= 0.7;  // Strong penalty for incomplete patterns
    }

    // 6. Pause indicators and fillers (weak indicators)
    const pauseFillers = [
        /\b(um|uh|hmm|er|ah|eh)\s*$/i,
        /\.{2,}\s*$/,  // Multiple dots
        /\s{2,}$/  // Multiple spaces (can indicate pause)
    ];

    if (pauseFillers.some(pattern => pattern.test(text))) {
        score += 0.3;  // Moderate indicator
    }

    // 7. Command/request completion
    const commandPatterns = [
        /^(please|can you|could you|would you)\b.*[.!]?\s*$/i,
        /\b(help me|show me|tell me|give me|send me)\b.*[.!]?\s*$/i,
        /\b(find|search|look for|check)\b.*[.!]?\s*$/i
    ];

    if (commandPatterns.some(pattern => pattern.test(text))) {
        score += 0.5;
    }

    // 8. Length-based scoring (current text analysis)
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount >= 3 && wordCount <= 15) {
        score += 0.2;  // Good length for complete thoughts
    }
    if (wordCount > 20) {
        score += 0.1;  // Longer text might be complete
    }

    // 9. Emotional expressions (often end turns)
    const emotionalEndings = [
        /\b(wow|great|amazing|awesome|terrible|awful|sad|happy|excited|surprised)\s*[!.]\s*$/i,
        /[!]{2,}\s*$/,  // Multiple exclamation marks
        /\b(oh no|oh wow|oh my|oh god|oh dear)\b/i
    ];

    if (emotionalEndings.some(pattern => pattern.test(text))) {
        score += 0.4;
    }

    // 10. Conversational turn-taking cues
    const turnTakingCues = [
        /\b(you know|I mean|like I said|basically|actually|honestly|seriously)\b.*[.!]\s*$/i,
        /\b(right|correct|exactly|precisely|absolutely)\s*[.!]?\s*$/i,
        /\b(your turn|go ahead|over to you)\b/i
    ];

    if (turnTakingCues.some(pattern => pattern.test(text))) {
        score += 0.5;
    }

    // Threshold-based decision (adjusted for real-time processing)
    const threshold = 0.5;  // Lower threshold for real-time detection
    return score >= threshold;
}

// Service Initialization
const services = {
    twilio: new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
    polly: new PollyClient({
        region: "us-east-1",
        credentials: {
            accessKeyId: process.env.accessKeyId,
            secretAccessKey: process.env.secretAccessKey,
        },
    }),
    openai: new OpenAI({ apiKey: process.env.OPEN_AI })
    // openai: new OpenAI({ apiKey: 'sk-abcdef1234567890abcdef1234567890abcdef12' })
};

const functions = {
    async getAllProducts(cursor = null) {
        const query = `
    {
      products(first: 50${cursor ? `, after: "${cursor}"` : ''}) {
        edges {
          cursor
          node {
            id
            title
            handle
            description
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

        const response = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        });

        const data = await response.json();
        if (!data.data || !data.data.products) return { products: [], hasNextPage: false, lastCursor: null };

        const products = data.data.products.edges.map(edge => ({
            id: edge.node.id,
            title: edge.node.title,
            handle: edge.node.handle,
            description: edge.node.description,
            variants: edge.node.variants.edges.map(variantEdge => ({
                id: variantEdge.node.id,
                title: variantEdge.node.title
            }))
        }));

        const hasNextPage = data.data.products.pageInfo.hasNextPage;
        const lastCursor = data.data.products.edges.length > 0 ? data.data.products.edges[data.data.products.edges.length - 1].cursor : null;

        return products;
    },

    async getUserDetailsByPhoneNo(phone) {
        const query = `
        {
          customers(first: 1, query: "phone:${phone}") {
            edges {
              node {
                id
                firstName
                lastName
                email
                phone
                numberOfOrders
              }
            }
          }
        }
        `;

        const response = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        });

        const data = await response.json();
        if (!data.data || !data.data.customers.edges.length) return null;

        const user = data.data.customers.edges[0].node;
        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            ordersCount: user.ordersCount
        };
    },

    async getAllOrders(cursor = null) {
        const query = `
    {
      orders(first: 50${cursor ? `, after: "${cursor}"` : ''}) {
        edges {
          cursor
          node {
            id
            name
            email
            phone
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            createdAt
            fulfillmentStatus
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

        const response = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        });

        const data = await response.json();
        if (!data.data || !data.data.orders) return { orders: [], hasNextPage: false, lastCursor: null };

        const orders = data.data.orders.edges.map(edge => ({
            id: edge.node.id,
            name: edge.node.name,
            email: edge.node.email,
            phone: edge.node.phone,
            total: edge.node.totalPriceSet.shopMoney.amount,
            currency: edge.node.totalPriceSet.shopMoney.currencyCode,
            createdAt: edge.node.createdAt,
            fulfillmentStatus: edge.node.fulfillmentStatus,
            lineItems: edge.node.lineItems.edges.map(itemEdge => ({
                title: itemEdge.node.title,
                quantity: itemEdge.node.quantity
            }))
        }));

        const hasNextPage = data.data.orders.pageInfo.hasNextPage;
        const lastCursor = data.data.orders.edges.length > 0 ? data.data.orders.edges[data.data.orders.edges.length - 1].cursor : null;

        return { orders, hasNextPage, lastCursor };
    },

    async getOrderById(orderId) {
        const query = `
    {
      order(id: "${orderId}") {
        id
        name
        email
        phone
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        createdAt
        fulfillmentStatus
        lineItems(first: 10) {
          edges {
            node {
              title
              quantity
            }
          }
        }
      }
    }
  `;

        const response = await fetch(graphqlEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        });

        const data = await response.json();
        if (!data.data || !data.data.order) return null;

        const order = data.data.order;
        return {
            id: order.id,
            name: order.name,
            email: order.email,
            phone: order.phone,
            total: order.totalPriceSet.shopMoney.amount,
            currency: order.totalPriceSet.shopMoney.currencyCode,
            createdAt: order.createdAt,
            fulfillmentStatus: order.fulfillmentStatus,
            lineItems: order.lineItems.edges.map(itemEdge => ({
                title: itemEdge.node.title,
                quantity: itemEdge.node.quantity
            }))
        };
    }
}

// Configuration Constants
const CONFIG = {
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 1000,
    AUDIO_CHUNK_SIZE: 1600,
    DEEPGRAM_STREAM_CHUNK_SIZE: 800,
    SAMPLE_RATE: 16000,
    AUDIO_SAMPLE_RATE: 8000,
    POLLY_VOICE_ID: "Joanna",
    POLLY_OUTPUT_FORMAT: "mp3",
    GPT_MODEL: "gpt-4o-mini",
    GPT_MAX_TOKENS: 150,
    GPT_TEMPERATURE: 0.1,
    DENOISER_RATE: 48000,
};

// Performance Monitoring
const performance = {
    latency: {
        total: 0,
        count: 0,
        min: Infinity,
        max: 0,
        lastUpdate: Date.now()
    },
    updateStats: function (latency) {
        this.latency.total += latency;
        this.latency.count++;
        this.latency.min = Math.min(this.latency.min, latency);
        this.latency.max = Math.max(this.latency.max, latency);

        const now = Date.now();
        if (now - this.latency.lastUpdate >= 5000) {
            const avg = this.latency.total / this.latency.count;
            console.log('\n=== Global Performance Metrics ===');
            console.log(`Average Latency: ${avg.toFixed(2)}ms`);
            console.log(`Min Latency: ${this.latency.min.toFixed(2)}ms`);
            console.log(`Max Latency: ${this.latency.max.toFixed(2)}ms`);
            console.log(`Total Samples: ${this.latency.count}`);
            console.log('==================================\n');

            this.latency.total = 0;
            this.latency.count = 0;
            this.latency.min = Infinity;
            this.latency.max = 0;
            this.latency.lastUpdate = now;
        }
    }
};

function generateRandomIdFromData(data, length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < length; i++) {
        randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${data}-${randomStr}`;
}

// User Storage
class UserStorage {
    constructor() {
        this.users = []; // In-memory storage array
    }

    // User class definition
    static createUser(userData) {
        return {
            Name: userData.Name || '',
            UserId: userData.UserId || '',
            Phone: userData.Phone || '',
            PastSessionId: userData.PastSessionId || [],
            ActiveSessionId: userData.ActiveSessionId || '',
            Email: userData.Email || ''
        };
    }

    // Add a new user
    addUser(userData) {
        const user = UserStorage.createUser(userData);

        // Check if user already exists (by UserId or Phone or Email)
        if (this.findUser(user.UserId) || this.findUser(user.Phone) || this.findUser(user.Email)) {
            throw new Error('User already exists with this UserId, Phone, or Email');
        }

        this.users.push(user);
        return user;
    }

    // Universal selector - find user by ANY parameter
    findUser(searchValue) {
        if (!searchValue) return null;

        return this.users.find(user => {
            // Search through all user fields
            return user.Name === searchValue ||
                user.UserId === searchValue ||
                user.Phone === searchValue ||
                user.Email === searchValue ||
                user.ActiveSessionId === searchValue ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(searchValue));
        });
    }

    // Find multiple users (returns array)
    findUsers(searchValue) {
        if (!searchValue) return [];

        return this.users.filter(user => {
            return user.Name === searchValue ||
                user.UserId === searchValue ||
                user.Phone === searchValue ||
                user.Email === searchValue ||
                user.ActiveSessionId === searchValue ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(searchValue));
        });
    }

    // Search with partial matching (case-insensitive)
    searchUsers(searchTerm) {
        if (!searchTerm) return [];

        const term = searchTerm.toLowerCase();
        return this.users.filter(user => {
            return user.Name.toLowerCase().includes(term) ||
                user.UserId.toLowerCase().includes(term) ||
                user.Phone.includes(term) ||
                user.Email.toLowerCase().includes(term) ||
                user.ActiveSessionId.toLowerCase().includes(term);
        });
    }

    // Update user by any identifier
    updateUser(identifier, updates) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }

        // Update fields
        Object.keys(updates).forEach(key => {
            if (user.hasOwnProperty(key)) {
                user[key] = updates[key];
            }
        });

        return user;
    }

    // Delete user by any identifier
    deleteUser(identifier) {
        const index = this.users.findIndex(user => {
            return user.Name === identifier ||
                user.UserId === identifier ||
                user.Phone === identifier ||
                user.Email === identifier ||
                user.ActiveSessionId === identifier ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(identifier));
        });

        if (index === -1) {
            throw new Error('User not found');
        }

        return this.users.splice(index, 1)[0];
    }

    // Get all users
    getAllUsers() {
        return [...this.users]; // Return copy to prevent direct modification
    }

    // Convert to JSON string
    toJSON() {
        return JSON.stringify(this.users, null, 2);
    }

    // Load from JSON string
    fromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            this.users = data.map(userData => UserStorage.createUser(userData));
            return this.users;
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
    }

    // Load from JSON object/array
    loadFromData(data) {
        if (Array.isArray(data)) {
            this.users = data.map(userData => UserStorage.createUser(userData));
        } else {
            throw new Error('Data must be an array of user objects');
        }
        return this.users;
    }

    // Add session to user's past sessions
    addPastSession(identifier, sessionId) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }

        if (!Array.isArray(user.PastSessionId)) {
            user.PastSessionId = [];
        }

        if (!user.PastSessionId.includes(sessionId)) {
            user.PastSessionId.push(sessionId);
        }

        return user;
    }

    // Set active session and move current active to past
    setActiveSession(identifier, newSessionId) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }

        // Move current active session to past sessions
        if (user.ActiveSessionId) {
            this.addPastSession(identifier, user.ActiveSessionId);
        }

        user.ActiveSessionId = newSessionId;
        return user;
    }

    // Get user count
    getUserCount() {
        return this.users.length;
    }
}

const userStorage = new UserStorage();

// Example 1: Add users
try {
    userStorage.addUser({
        Name: 'Shubhanshu Pandey',
        UserId: 'Shub_9313',
        Phone: '+919313562780',
        Email: 'Shubhanshu@example.com',
    });

    userStorage.addUser({
        Name: 'Ankit Patil',
        UserId: 'Ankit_9512',
        Phone: '+919512467691',
        Email: 'Ankit@example.com'
    });

    userStorage.addUser({
        Name: 'Abhinav Baldha',
        UserId: 'Abhinav_9512',
        Phone: '+918780899485',
        Email: 'Abhinav@example.com'
    });

    console.log('Users added successfully');
} catch (error) {
    console.error('Error adding user:', error.message);
}

// Session Management
class SessionManager {
    constructor() {
        this.sessions = new Map(); // Stores active sessions by roomName
    }

    createSession(roomName, userData) {
        let user = userStorage.findUser(userData)
        // console.log(user)
        if (user) {
            if (user.ActiveSessionId) {
                if (this.sessions.has(user.ActiveSessionId)) {
                    console.warn(`Session ${user.ActiveSessionId}: already exists, re-creating.`);
                    let currentSession = this.getSession(user.ActiveSessionId);
                    currentSession.room = roomName;
                    return currentSession
                }
            }

            const id = generateRandomIdFromData(userData);
            const session = {
                id: id,
                room: roomName,
                dgSocket: null,
                reconnectAttempts: 0,
                lastTranscript: '',
                transcriptBuffer: [],
                audioStartTime: null,
                userPhoneno: user.Phone,
                lastInterimTime: Date.now(),
                isSpeaking: false,
                lastInterimTranscript: '',
                interimResultsBuffer: [],
                userSpeak: false,
                streamSid: '',
                callSid: '',
                isAIResponding: false,
                currentAudioStream: null,
                interruption: false,
                lastInterruptionTime: 0,
                interruptionCooldown: 200,
                ASSISTANT_ID: null,
                lastResponseId: null,
                threadId: null,
                phoneNo: user.Phone,
                currentMessage: {},
                availableChannel: [],
                chatHistory: [{
                    role: 'assistant',
                    content: `Hello ${user.Name} You are speaking to an AI assistant for Gautam Garment.`
                }],
                //                 prompt: `You are a helpful AI assistant for the Shopify store "Gautam Garment". The user Name is ${user.Name}  You have access to several tools (functions) that let you fetch and provide real-time information about products, orders, and customers from the store.

                // Your Tasks:

                // Understand the user's message and intent.
                // If you need specific store data (like product lists, order details, or customer info), use the available tools by calling the appropriate function with the required parameters.
                // After receiving tool results, use them to generate a helpful, concise, and accurate response for the user.
                // Always return your answer in JSON format with two fields:
                // "response": your textual reply for the user
                // "output_channel": the medium for your response

                // Example Output:
                // {
                // "response": "Here are the top 5 products from Gautam Garment.",
                // "output_channel": "audio"
                // }

                // User Input Format:
                // The user's message will be a JSON object with "message" and "input_channel", for example:
                // {
                // "message": "Show me my recent orders",
                // "input_channel": "audio"
                // }

                // Available Tools (functions):
                // getAllProducts: Get a list of all products in the store.
                // getUserDetailsByPhoneNo: Get customer details by phone number.
                // getAllOrders: Get a list of all orders.
                // getOrderById: Get details for a specific order by its ID.

                // Instructions:
                // If a user's request requires store data, call the relevant tool first, then use its result in your reply.
                // If the user asks a general question or your response does not require real-time store data, answer directly.
                // ***Always use the user's input_channel for your response if it matches the available ***
                // The store name is "Gautam Garment"—refer to it by name in your responses when appropriate.`,
                prompt: `You are an AI assistant for "Gautam Garment" Shopify store. 
**Process:**
1. Understand user intent
2. Use tools if you need store data (products, orders, customers)
3. Respond in JSON format:
{
"response": "your answer here",
"output_channel": "audio"
} `,
                metrics: { llm: 0, stt: 0, tts: 0 },

                ffmpegProcess: null,
                vadProcess: null,
                turndetectionprocess: null,
                vadDeepgramBuffer: Buffer.alloc(0),
                isVadSpeechActive: false,
                currentUserUtterance: '',
                isTalking: false,
                tools: [],
                denoiser: null,
                remainder: null
            };
            userStorage.setActiveSession(userData, id);
            this.sessions.set(id, session);
            console.log(`Session ${roomName}: Created new session.`);
            return session;
        }
        const id = generateRandomIdFromData("temp");
        const session = {
            id: id,
            room: roomName,
            dgSocket: null,
            reconnectAttempts: 0,
            lastTranscript: '',
            transcriptBuffer: [],
            audioStartTime: null,
            userPhoneno: "",
            lastInterimTime: Date.now(),
            isSpeaking: false,
            lastInterimTranscript: '',
            interimResultsBuffer: [],
            userSpeak: false,
            streamSid: '',
            callSid: '',
            isAIResponding: false,
            currentAudioStream: null,
            interruption: false,
            lastInterruptionTime: 0,
            interruptionCooldown: 200,
            ASSISTANT_ID: null,
            lastResponseId: null,
            threadId: null,
            phoneNo: "",
            currentMessage: {},
            availableChannel: [],
            chatHistory: [{
                role: 'assistant',
                content: "Hello! You are speaking to an AI assistant for Gautam Garment."
            }],
            //             prompt: `You are a helpful AI assistant for the Shopify store "Gautam Garment". You have access to several tools (functions) that let you fetch and provide real-time information about products, orders, and customers from the store.
            prompt: `You are an AI assistant for "Gautam Garment" Shopify store. 
**Process:**
1. Understand user intent
2. Use tools if you need store data (products, orders, customers)
3. Respond in JSON format:
{
"response": "your answer here",
"output_channel": "audio"
} `,
            metrics: { llm: 0, stt: 0, tts: 0 },

            ffmpegProcess: null,
            vadProcess: null,
            turndetectionprocess: null,
            vadDeepgramBuffer: Buffer.alloc(0),
            isVadSpeechActive: false,
            currentUserUtterance: '',
            isTalking: false,
            tools: [],
            denoiser: null,
            remainder: null
        };
        this.sessions.set(id, session);
        console.log(`Session ${roomName}: Created new session.`);
        return session;
    }

    getSession(roomName) {
        return this.sessions.get(roomName);
    }

    deleteSession(roomName) {
        const session = this.sessions.get(roomName);
        if (session) {
            this.cleanupSession(roomName);
            this.sessions.delete(roomName);
            console.log(`Session ${roomName}: Deleted session.`);
        }
    }

    cleanupSession(roomName) {
        const session = this.sessions.get(roomName);
        if (session) {
            if (session.dgSocket?.readyState === 1) { // WebSocket.OPEN
                session.dgSocket.close();
                console.log(`Session ${roomName}: Closed Deepgram socket.`);
            }

            if (session.ffmpegProcess) {
                session.ffmpegProcess.stdin.end();
                session.ffmpegProcess.kill('SIGINT');
                console.log(`Session ${roomName}: Terminated ffmpeg process.`);
            }
            if (session.vadProcess) {
                session.vadProcess.stdin.end();
                session.vadProcess.kill('SIGINT');
                console.log(`Session ${roomName}: Terminated VAD process.`);
            }

            if (session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
                session.currentAudioStream.stop();
            }
            session.isAIResponding = false;
        }
    }
}

// Audio Processing Utilities
const audioUtils = {
    generateSilenceBuffer: (durationMs, sampleRate = CONFIG.AUDIO_SAMPLE_RATE) => {
        const numSamples = Math.floor((durationMs / 1000) * sampleRate);
        return Buffer.alloc(numSamples);
    },

    convertMp3ToMulaw(mp3Buffer, sessionId) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-f', 'mulaw',
                '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(),
                '-ac', '1',
                '-acodec', 'pcm_mulaw',
                '-y',
                'pipe:1'
            ]);

            let mulawBuffer = Buffer.alloc(0);

            ffmpeg.stdout.on('data', (data) => {
                mulawBuffer = Buffer.concat([mulawBuffer, data]);
            });

            ffmpeg.stderr.on('data', (data) => {
                // console.log(`Session ${ sessionId }: FFmpeg stderr for conversion: `, data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(mulawBuffer);
                } else {
                    console.error(`Session ${sessionId}: FFmpeg process failed with code ${code} during MP3 to Mulaw conversion.`);
                    reject(new Error(`ffmpeg process failed with code ${code} `));
                }
            });

            ffmpeg.on('error', (err) => {
                console.error(`Session ${sessionId}: FFmpeg process error during MP3 to Mulaw conversion: `, err);
                reject(err);
            });

            ffmpeg.stdin.write(mp3Buffer);
            ffmpeg.stdin.end();
        });
    },

    convertMp3ToPcmInt16(mp3Buf, sessionId) {
        return new Promise((resolve, reject) => {
            console.log(`🔄 Converting MP3 buffer of size: ${mp3Buf.length} bytes`);

            const ff = spawn('ffmpeg', [
                '-hide_banner', '-loglevel', 'error',
                '-i', 'pipe:0',
                '-f', 's16le',
                '-acodec', 'pcm_s16le',
                '-ac', '1',          // mono
                '-ar', '16000',      // 16 kHz
                '-y',                // overwrite output
                'pipe:1'
            ]);

            const chunks = [];
            let errorOutput = '';

            ff.stdout.on('data', chunk => {
                chunks.push(chunk);
            });

            ff.stderr.on('data', data => {
                errorOutput += data.toString();
            });

            ff.on('close', code => {
                if (code === 0) {
                    const buffer = Buffer.concat(chunks);
                    const pcmArray = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
                    console.log(`✅ MP3 conversion successful: ${pcmArray.length} samples`);
                    resolve(pcmArray);
                } else {
                    console.error(`❌ FFmpeg error: ${errorOutput} `);
                    reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput} `));
                }
            });

            ff.on('error', error => {
                console.error('❌ FFmpeg spawn error:', error);
                reject(error);
            });

            ff.stdin.on('error', error => {
                console.error('❌ FFmpeg stdin error:', error);
            });

            ff.stdin.end(mp3Buf);
        });
    },

    streamMulawAudioToLiveKit: function (room, mulawBuffer, session) {
        const pcm = mulawBuffer;
        const CHUNK_SIZE_MULAW = 800;
        let offset = 0;
        session.isAIResponding = true;
        session.interruption = false;

        let source = null;
        let track = null;
        let isPublished = false;

        const stopFunction = () => {
            console.log(`Session ${session.id}: Stopping outgoing audio stream...`);
            session.interruption = true;
            session.isAIResponding = false;
            offset = mulawBuffer.length;
            session.currentAudioStream = null;

            // Clean up the track
            if (isPublished && track) {
                try {
                    room.localParticipant.unpublishTrack(track);
                    console.log(`Session ${session.id}: Track unpublished`);
                } catch (error) {
                    console.error(`Session ${session.id}: Error unpublishing track: `, error);
                }
            }
        };

        session.currentAudioStream = { stop: stopFunction };

        async function initializeAudioTrack() {
            try {
                source = new AudioSource(16000, 1);
                track = LocalAudioTrack.createAudioTrack('ai-response', source);

                await room.localParticipant.publishTrack(track, {
                    source: TrackSource.SOURCE_MICROPHONE,
                    name: 'ai-response'
                });

                isPublished = true;
                console.log(`🎵 Track published to room: ${room} `);
            } catch (error) {
                console.error(`Session ${session.id}: Error initializing audio track: `, error);
                stopFunction();
                throw error;
            }
        }

        async function sendChunk() {
            // Check for interruption at the start of each chunk
            if (session.interruption) {
                console.log(`Session ${session.id}: Audio stream interrupted.`);
                session.isAIResponding = false;
                session.currentAudioStream = null;
                return;
            }

            if (offset >= mulawBuffer.length) {
                console.log(`Session ${session.id}: Audio stream completed.`);
                session.isAIResponding = false;
                session.currentAudioStream = null;
                return;
            }

            const chunk = mulawBuffer.slice(offset, offset + CHUNK_SIZE_MULAW);
            if (chunk.length === 0) {
                console.log(`Session ${session.id}: Last chunk is empty, ending stream.`);
                session.isAIResponding = false;
                session.currentAudioStream = null;
                return;
            }

            try {
                // Create audio frame from the chunk
                const audioFrame = new AudioFrame(chunk, 16000, 1, chunk.length);

                // Send the frame to the audio source
                await source.captureFrame(audioFrame);

                // console.log(`Session ${ session.id }: Sent audio chunk ${ offset } -${ offset + chunk.length } `);

                offset += CHUNK_SIZE_MULAW;

                // Schedule next chunk with proper timing
                // Calculate delay based on chunk duration (assuming 16kHz sample rate)
                const chunkDurationMs = (chunk.length / 16000) * 1000;

                setTimeout(() => {
                    if (!session.interruption) {
                        sendChunk();
                    }
                }, chunkDurationMs);

            } catch (error) {
                console.error(`Session ${session.id}: Error sending audio chunk: `, error);
                stopFunction();
            }
        }

        // Initialize the audio track first, then start streaming
        initializeAudioTrack()
            .then(() => {
                console.log(`Session ${session.id}: Starting audio stream...`);
                sendChunk();
            })
            .catch(error => {
                console.error(`Session ${session.id}: Failed to initialize audio streaming: `, error);
                stopFunction();
            });
    },

    streamPCMAudioToLiveKit: function (room, session, onComplete) {
        const CHUNK_SIZE_PCM = 800; // Adjust based on your needs
        session.isAIResponding = true;
        session.interruption = false;

        let source = null;
        let track = null;
        let isPublished = false;
        let audioQueue = [];
        let isStreaming = false;

        const stopFunction = () => {
            console.log(`Session ${session.id}: Stopping outgoing audio stream...`);
            session.interruption = true;
            session.isAIResponding = false;
            session.currentAudioStream = null;
            audioQueue = [];

            // Clean up the track
            if (isPublished && track) {
                try {
                    room.localParticipant.unpublishTrack(track);
                    console.log(`Session ${session.id}: Track unpublished`);
                } catch (error) {
                    console.error(`Session ${session.id}: Error unpublishing track: `, error);
                }
            }

            if (onComplete) onComplete();
        };

        session.currentAudioStream = { stop: stopFunction };

        async function initializeAudioTrack() {
            try {
                source = new AudioSource(16000, 1);
                track = LocalAudioTrack.createAudioTrack('ai-response', source);

                await room.localParticipant.publishTrack(track, {
                    source: TrackSource.SOURCE_MICROPHONE,
                    name: 'ai-response'
                });

                isPublished = true;
                console.log(`🎵 Track published to room: ${room} `);
            } catch (error) {
                console.error(`Session ${session.id}: Error initializing audio track: `, error);
                stopFunction();
                throw error;
            }
        }

        // Function to add audio chunks to queue
        const addAudioChunk = async (pcmArray) => {
            if (session.interruption) return;

            audioQueue.push(pcmArray);

            // Start streaming if not already streaming
            if (!isStreaming) {
                isStreaming = true;
                processAudioQueue();
            }
        };

        async function processAudioQueue() {
            while (audioQueue.length > 0 && !session.interruption) {
                const pcmArray = audioQueue.shift();

                try {
                    // Create audio frame from the PCM data
                    const audioFrame = new AudioFrame(pcmArray, 16000, 1, pcmArray.length);

                    // Send the frame to the audio source
                    await source.captureFrame(audioFrame);

                    // console.log(`Session ${ session.id }: Sent audio chunk, size: ${ pcmArray.length } samples`);

                    // Calculate delay based on chunk duration
                    const chunkDurationMs = (pcmArray.length / 16000) * 1000;

                    // Small delay to maintain proper timing
                    await new Promise(resolve => setTimeout(resolve, chunkDurationMs));

                } catch (error) {
                    console.error(`Session ${session.id}: Error sending audio chunk: `, error);
                    stopFunction();
                    return;
                }
            }

            // Mark streaming as complete when queue is empty
            if (audioQueue.length === 0) {
                isStreaming = false;
                console.log(`Session ${session.id}: Audio queue processed completely`);

                // Small delay before cleanup to ensure all audio is played
                setTimeout(() => {
                    if (audioQueue.length === 0) {
                        stopFunction();
                    }
                }, 100);
            }
        }

        // Initialize the audio track first
        initializeAudioTrack()
            .then(() => {
                console.log(`Session ${session.id}: Audio track initialized, ready for streaming...`);
            })
            .catch(error => {
                console.error(`Session ${session.id}: Failed to initialize audio streaming: `, error);
                stopFunction();
            });

        return addAudioChunk;
    },

    streamMulawAudioToTwilio: function (ws, streamSid, mulawBuffer, session) {
        const CHUNK_SIZE_MULAW = 800; // 20ms of 8khz mulaw (8000 samples/sec * 0.020 sec = 160 samples, 1 byte/sample)
        let offset = 0;
        session.isAIResponding = true;
        session.interruption = false; // Reset interruption flag when AI starts speaking

        const stopFunction = () => {
            console.log(`Session ${session.id}: Stopping outgoing audio stream...`);
            session.interruption = true; // Mark for immediate stop
            session.isAIResponding = false;
            offset = mulawBuffer.length; // Force stop by setting offset to end
            session.currentAudioStream = null; // Clear reference
        };

        session.currentAudioStream = { stop: stopFunction }; // Store stop function for external interruption

        function sendChunk() {
            if (offset >= mulawBuffer.length || session.interruption) {
                console.log(`Session ${session.id}: Audio stream ended or interrupted.`);
                session.isAIResponding = false;
                session.currentAudioStream = null;
                return;
            }

            const chunk = mulawBuffer.slice(offset, offset + CHUNK_SIZE_MULAW);
            if (chunk.length === 0) { // Handle case where the last chunk is empty
                console.log(`Session ${session.id}: Last chunk is empty, ending stream.`);
                session.isAIResponding = false;
                session.currentAudioStream = null;
                return;
            }

            try {
                ws.send(JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: { payload: chunk.toString('base64') }
                }));
                offset += CHUNK_SIZE_MULAW;
                // Schedule next chunk slightly faster than chunk duration for continuous flow
                setTimeout(sendChunk, 100); // 180ms delay for 200ms chunk
            } catch (error) {
                console.error(`Session ${session.id}: Error sending audio chunk: `, error);
                stopFunction(); // Stop on error
            }
        }
        sendChunk(); // Start sending chunks
    }
};

// AI Processing
const aiProcessing = {
    async processInput(input, session) {
        // console.log("here are the sessions details :", session.prompt, session.tools)

        const createResponseParams = {
            model: "gpt-4o-mini",
            input: input.message,
            instructions: session.prompt,
            tools: session.tools
            // tools: toolDefinitions
        };
        if (session.lastResponseId) {
            createResponseParams.previous_response_id = session.lastResponseId;
        }
        let processTimeStart = Date.now()
        let response = await services.openai.responses.create(createResponseParams);
        let processTime = Date.now() - processTimeStart
        console.log("LLmProcessTime", processTime)
        session.lastResponseId = response.id;

        if (response.output[0].type === "function_call") {
            const tool = []
            let toolResult;

            if (response.output[0].name === "getAllProducts") {
                toolResult = await functions.getAllProducts();
            } else if (response.output[0].name === "getUserDetailsByPhoneNo") {
                toolResult = await functions.getUserDetailsByPhoneNo(session.caller);
            } else if (response.output[0].name === "getAllOrders") {
                toolResult = await functions.getAllOrders();
            } else if (response.output[0].name === "getOrderById") {
                toolResult = await functions.getOrderById(args.orderId);
            } else {
                toolResult = { error: "Unknown tool requested." };
            }

            tool.push({
                type: "function_call_output",
                call_id: response.output[0].call_id,
                output: JSON.stringify({ toolResult })
            });

            response = await services.openai.responses.create({
                model: "gpt-4o-mini",
                instructions: session.prompt,
                input: tool,
                previous_response_id: session.lastResponseId
            });
            session.lastResponseId = response.id;
        }

        session.lastResponseId = response.id;


        const messages = response.output || [];
        const assistantMessage = messages.find(m => m.role === "assistant");

        let parsedData;
        try {
            parsedData = JSON.parse(assistantMessage.content[0].text);
            return { processedText: parsedData.response, outputType: parsedData.output_channel };
        } catch (error) {
            return {
                processedText: assistantMessage.content[0].text || "Sorry, I had trouble understanding. Could you please rephrase?",
                outputType: input.input_channel
            };
        }
    },

    async synthesizeSpeech2(text, sessionId) {
        if (!text) {
            console.error(`Session ${sessionId}: No text provided for synthesis.`);
            return null;
        }

        const startTime = Date.now();

        try {
            const response = await fetch('https://api.gabber.dev/v1/voice/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTE3ODQ3NDgsImh1bWFuIjoic3RyaW5nIiwicHJvamVjdCI6IjkzYTUyY2Y4LTNmYTQtNDhjYi1hYTMyLWJiMzkxNDQxZTI4NSJ9.qJq78UrY86Hf - i6oUN6PPiSXgn51aewbSNus2 - mGC6Q`,
                },
                body: JSON.stringify({
                    text,
                    voice_id: process.env.GABBER_VOICEID_MALE,
                })
            });

            const latency = Date.now() - startTime;
            console.log(`Session ${sessionId}: TTS Latency: ${latency} ms`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`❌ Gabber API failed[${response.status}]: ${errorText} `);
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);

        } catch (err) {
            const raw = err.response?.data;
            const decoded = raw && Buffer.isBuffer(raw)
                ? raw.toString()
                : JSON.stringify(raw);

            console.error(`Session ${sessionId}: Speech synthesis error with Gabber: `, decoded || err.message);
            throw err;
        }
    },

    async synthesizeSpeech3(text, sessionId) {
        if (!text) {
            console.error(`Session ${sessionId}: No text provided for synthesis.`);
            return null;
        }
        const startTime = Date.now();
        try {
            const command = new SynthesizeSpeechCommand({
                Text: text,
                VoiceId: CONFIG.POLLY_VOICE_ID,
                OutputFormat: CONFIG.POLLY_OUTPUT_FORMAT
            });

            const data = await services.polly.send(command);
            if (data.AudioStream) {
                const audioBuffer = Buffer.from(await data.AudioStream.transformToByteArray());
                const latency = Date.now() - startTime;
                console.log(`Session ${sessionId}: TTS Latency: ${latency} ms`);
                return audioBuffer;
            }
            throw new Error("AudioStream not found in Polly response.");
        } catch (err) {
            console.error(`Session ${sessionId}: Speech synthesis error with Polly: `, err);
            throw err;
        }
    },

    async synthesizeSpeech(text, sessionId) {
        if (!text) {
            console.error(`Session ${sessionId}: No text provided for synthesis.`);
            return null;
        }

        const streamToBuffer = async (stream) => {
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        };

        const startTime = Date.now();

        try {
            const response = await deepgramTts.speak.request(
                { text },
                {
                    model: 'aura-2-thalia-en',
                    encoding: 'mp3',// Optional, still valid
                    // ✅ DO NOT include `container`
                }
            );

            const stream = await response.getStream();

            if (!stream) {
                throw new Error('Failed to get audio stream from Deepgram response');
            }

            const mp3Buffer = await streamToBuffer(stream);

            const latency = Date.now() - startTime;
            console.log(`Session ${sessionId}: Deepgram TTS Latency: ${latency} ms`);
            console.log(`Session ${sessionId}: MP3 Buffer size: ${mp3Buffer.length} bytes`);

            return mp3Buffer;

        } catch (err) {
            console.error(`Session ${sessionId}: Speech synthesis error with Deepgram: `, err);
            throw err;
        }
    },

    async synthesizeSpeechStream(text, sessionId, onChunkCallback) {
        if (!text) {
            console.error(`Session ${sessionId}: No text provided for synthesis.`);
            return null;
        }

        const startTime = Date.now();

        try {
            // Use Live TTS API instead of standard request
            const dgConnection = deepgramTts.speak.live({
                model: 'aura-2-thalia-en',
                encoding: 'linear16',
                sample_rate: 16000,  // Match your LiveKit sample rate
                container: 'none',
            });

            let totalChunks = 0;
            let firstChunkTime = null;
            let leftoverBuffer = null;

            // Set up event handlers
            dgConnection.on(LiveTTSEvents.Open, () => {
                console.log(`Session ${sessionId}: Live TTS connection opened`);

                // Send text data for TTS synthesis
                dgConnection.sendText(text);

                // Send Flush message to the server after sending the text
                dgConnection.flush();
            });

            dgConnection.on(LiveTTSEvents.Audio, async (data) => {
                if (!firstChunkTime) {
                    firstChunkTime = Date.now() - startTime;
                    console.log(`Session ${sessionId}: First chunk received in ${firstChunkTime} ms`);
                }

                // Convert chunk to Uint8Array for easier manipulation
                const chunkArray = new Uint8Array(data);

                // Combine with leftover bytes from previous chunk
                let combinedArray;
                if (leftoverBuffer) {
                    combinedArray = new Uint8Array(leftoverBuffer.length + chunkArray.length);
                    combinedArray.set(leftoverBuffer);
                    combinedArray.set(chunkArray, leftoverBuffer.length);
                    leftoverBuffer = null;
                } else {
                    combinedArray = chunkArray;
                }

                // If odd number of bytes, save the last byte for next chunk
                let bytesToProcess = combinedArray.length;
                if (bytesToProcess % 2 !== 0) {
                    leftoverBuffer = new Uint8Array([combinedArray[bytesToProcess - 1]]);
                    bytesToProcess -= 1;
                }

                // Only process if we have bytes to process
                if (bytesToProcess > 0) {
                    // Create Int16Array from even number of bytes
                    const pcmArray = new Int16Array(
                        combinedArray.buffer.slice(
                            combinedArray.byteOffset,
                            combinedArray.byteOffset + bytesToProcess
                        )
                    );

                    totalChunks++;
                    // console.log(`Session ${ sessionId }: Processing chunk ${ totalChunks }, size: ${ pcmArray.length } samples`);

                    // Send chunk immediately to LiveKit
                    await onChunkCallback(pcmArray);
                }
            });

            dgConnection.on(LiveTTSEvents.Flushed, async () => {
                console.log(`Session ${sessionId}: Deepgram Flushed`);

                // Handle any remaining leftover bytes
                if (leftoverBuffer) {
                    console.log(`Session ${sessionId}: Processing final leftover byte`);
                    // Pad with zero to make it even
                    const finalArray = new Uint8Array(2);
                    finalArray.set(leftoverBuffer);
                    finalArray[1] = 0;

                    const finalPcmArray = new Int16Array(finalArray.buffer);
                    await onChunkCallback(finalPcmArray);
                }

                const totalLatency = Date.now() - startTime;
                console.log(`Session ${sessionId}: Live TTS streaming completed.Total time: ${totalLatency} ms, Total chunks: ${totalChunks} `);

                // Close the connection
                dgConnection.requestClose();
            });

            dgConnection.on(LiveTTSEvents.Close, () => {
                console.log(`Session ${sessionId}: Live TTS connection closed`);
            });

            dgConnection.on(LiveTTSEvents.Error, (err) => {
                console.error(`Session ${sessionId}: Live TTS error: `, err);
                throw err;
            });

            dgConnection.on(LiveTTSEvents.Metadata, (data) => {
                console.log(`Session ${sessionId}: Metadata received: `, data);
            });

            return new Promise((resolve, reject) => {
                dgConnection.on(LiveTTSEvents.Flushed, () => resolve(true));
                dgConnection.on(LiveTTSEvents.Error, reject);
            });

        } catch (err) {
            console.error(`Session ${sessionId}: Live TTS streaming error: `, err);
            throw err;
        }
    },

    async processTextToSpeech(processedText, session) {
        const TTSTimeStart = Date.now();

        try {
            // Initialize streaming to LiveKit (same as before)
            const addAudioChunk = audioUtils.streamPCMAudioToLiveKit(
                session.room,
                session,
                () => {
                    const TTSTime = Date.now() - TTSTimeStart;
                    console.log(`Session ${session.id}: Complete TTS pipeline time: ${TTSTime} ms`);
                }
            );

            // Start Live TTS streaming synthesis
            await aiProcessing.synthesizeSpeechStream(
                processedText,
                session.id,
                addAudioChunk
            );

        } catch (error) {
            console.error(`Session ${session.id}: Live TTS streaming failed: `, error);
            throw error;
        }
    }

};

const setChannel = (session, channel) => {
    if (!session.availableChannel.includes(channel)) {
        session.availableChannel.push(channel);
        let prompt = `${session.prompt}
        Available channels:
        ${session.availableChannel.join(",")}
        `
        session.prompt = prompt
    }
}

const changePrompt = (session, prompt, tools) => {
    let changePrompt = `${prompt}
        Available channels:
        ${session.availableChannel.join(",")}
        `
    session.prompt = changePrompt;
    session.tools = tools
}

// Initialize Express server
const app = express();
app.use(cors());
app.use(express.json());

// Session Management Instance
const sessionManager = new SessionManager();

setInterval(() => {
    sessionManager.sessions.forEach(s => {
        if (s.dgSocket?.readyState === WebSocket.OPEN) {
            s.dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
        }
    });
}, 10000);

// Generate access token for client
app.post('/get-token', async (req, res) => {
    try {
        const { roomName, participantName } = req.body;

        if (!roomName || !participantName) {
            return res.status(400).json({ error: 'roomName and participantName are required' });
        }

        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: participantName
        });
        at.addGrant({ roomJoin: true, room: roomName });

        // console.log(at)
        let token = await at.toJwt()

        res.json({ token: token });
    } catch (error) {
        console.error('Error generating token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// Create room and join as agent
app.post('/create-room', async (req, res) => {
    try {
        const { roomName, userData } = req.body;

        if (!roomName) {
            return res.status(400).json({ error: 'roomName is required' });
        }

        // Create room
        await roomService.createRoom({
            name: roomName,
            emptyTimeout: 20 * 60, // 10 minutes
            maxParticipants: 2,
        });

        // Join room as agent
        const room = new Room();
        const agentToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: 'AI-Agent',
        });
        agentToken.addGrant({ roomJoin: true, room: roomName });
        // console.log(agentToken)
        // console.log("livekit Url", LIVEKIT_URL)
        // console.log("livekit api", LIVEKIT_API_KEY)
        // console.log("livekit Sec", LIVEKIT_API_SECRET)
        let token = await agentToken.toJwt()
        await room.connect(LIVEKIT_URL, token, {
            autoSubscribe: true
        });

        // Create session for this room
        const session = sessionManager.createSession(room, userData);

        // Set up room event handlers
        setupRoomEventHandlers(room, session);

        res.json({
            success: true,
            sessionId: session.id,
            message: 'Room created and agent joined successfully',
            prompt: session.prompt
        });
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Setup room event handlers
function setupRoomEventHandlers(room, session) {
    room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log(`Session ${session.id}: Participant connected: ${participant.identity} `);

        // Initialize audio processing for this participant
        setupAudioProcessingForParticipant(participant, session);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log(`Session ${session.id}: Participant disconnected: ${participant.identity} `);
    });

    room.on(RoomEvent.Disconnected, () => {
        console.log(`Session ${session.id}: Room disconnected`);
        sessionManager.deleteSession(session.id);
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        handleTrackSubscribed(track, publication, participant, session);
        setChannel(session, "audio")
    });

    room.on(RoomEvent.ChatMessage, (message, participant) => {
        // console.log(payload)
        handleChatInput(message, participant, session)
    })
}

async function handleChatInput(message, participant, session) {
    try {
        // if (!payload || payload.length === 0) {
        //     console.warn(`⚠️ Received empty payload from ${ participant.identity } `);
        //     return;
        // }
        // console.log("payload", payload)
        console.log(message)
        const data = JSON.parse(message);
        console.log("data", data)
        if (data.type === 'chat') {
            console.log(`💬 Chat from ${participant.identity}: ${data.content} `);

            // Optionally: send an AI response back
            handleIncomingChat(data.content, participant, session);
        }
    } catch (err) {
        console.error('❌ Error parsing chat payload:', err);
    }
}

async function handleIncomingChat(message, participant, session) {
    // 🧠 Use OpenAI, Gemini, etc. to generate a response
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.availableChannel.includes("chat")) {
        setChannel(session, "chat")
    }

    const { processedText, outputType } = await aiProcessing.processInput(
        { message: message, input_channel: 'chat' },
        session
    );

    if (outputType === 'chat') {
        const replyPayload = JSON.stringify({
            type: 'chat',
            content: aiReply,
            from: 'ai-agent',
        });
        // Send the response back to the participant
        session.room.localParticipant.publishData(
            replyPayload,
            Livekit.DataPacket_Kind.RELIABLE,
            [participant.sid]  // Target only the sender
        );
    } else if (outputType === 'audio') {
        const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
        if (audioBuffer) {
            const mulawBuffer = await audioUtils.convertMp3ToMulaw(audioBuffer, session.id);
            if (mulawBuffer) {
                audioUtils.streamMulawAudioToLiveKit(session.room, mulawBuffer, session);
            }
        }
    }
}

async function handleTrackSubscribed(track, publication, participant, session) {
    if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(`Subscribed to ${participant.identity} 's audio track`);

        const stream = new AudioStream(track,
            {
                noiseCancellation: NC.NoiseCancellation()
            }
        );
        const CHUNK_MS = 50;
        const LIVEKIT_SAMPLE_RATE = 48000;
        const BATCH_SAMPLES = (LIVEKIT_SAMPLE_RATE * CHUNK_MS) / 1000; // = 2400 samples

        let sampleBuffer = [];

        for await (const frame of stream) {
            sampleBuffer.push(...frame.data);

            if (sampleBuffer.length >= BATCH_SAMPLES) {
                const buf = Buffer.from(new Int16Array(sampleBuffer).buffer);
                session.ffmpegProcess.stdin.write(buf);
                // console.log(`📤 Sent ${sampleBuffer.length} samples to FFmpeg`);
                sampleBuffer = [];
            }
        }

    }
}

// Setup audio processing for participant
function setupAudioProcessingForParticipant(participant, session) {
    // Initialize FFmpeg and VAD processes
    session.ffmpegProcess = spawn('ffmpeg', [
        '-loglevel', 'quiet',
        '-f', 's16le',            // Input format: 32-bit float PCM
        '-ar', '48000',           // Input sample rate
        '-ac', '1',               // Input channels
        '-i', 'pipe:0',           // Read from stdin

        '-f', 's16le',            // Output format
        '-acodec', 'pcm_s16le',   // Output codec
        '-ar', '16000',           // Output sample rate
        '-ac', '1',               // Output channel count
        'pipe:1'
    ]);
    // session.ffmpegProcess = spawn('ffmpeg', [
    //     '-loglevel', 'quiet',
    //     '-f', 'mulaw',
    //     '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(),
    //     '-ac', '1',
    //     '-i', 'pipe:0',
    //     '-f', 's16le',
    //     '-acodec', 'pcm_s16le',
    //     '-ar', CONFIG.SAMPLE_RATE.toString(),
    //     '-ac', '1',
    //     'pipe:1'
    // ]);

    session.vadProcess = spawn(process.env.PYTHON_PATH || 'python3', ['vad.py']);
    session.ffmpegProcess.stdout.pipe(session.vadProcess.stdin);
    session.ffmpegProcess.stderr.on('data', (data) => {
        console.error("Error in ffmpeg", data.toString());
    });

    // Handle VAD output
    session.vadProcess.stdout.on('data', (vadData) => {
        // console.log("vad", vadData);
        try {
            const parsedVAD = JSON.parse(vadData.toString());
            if (parsedVAD.event === 'speech_start') {
                session.isVadSpeechActive = true;
                console.log(`Session ${session.id}: VAD detected Speech START. Resetting Deepgram buffer.`);
                session.vadDeepgramBuffer = Buffer.alloc(0);
            } else if (parsedVAD.event === 'speech_end') {
                session.isVadSpeechActive = false;
                console.log(`Session ${session.id}: VAD detected Speech END.`);
                if (session.vadDeepgramBuffer.length > 0 && session.dgSocket?.readyState === 1) {
                    session.dgSocket.send(session.vadDeepgramBuffer);
                    session.vadDeepgramBuffer = Buffer.alloc(0);
                }
                if (session.dgSocket?.readyState === 1) {
                    console.log(`Session ${session.id}: Sending Deepgram Finalize message.`);
                    session.dgSocket.send(JSON.stringify({ "type": "Finalize" }));
                }
            }

            if (parsedVAD.chunk) {
                console.log("got the speech")
                const audioBuffer = Buffer.from(parsedVAD.chunk, 'hex');
                session.vadDeepgramBuffer = Buffer.concat([session.vadDeepgramBuffer, audioBuffer]);
                if (session.isVadSpeechActive && session.dgSocket?.readyState === 1) {
                    while (session.vadDeepgramBuffer.length >= CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE) {
                        const chunkToSend = session.vadDeepgramBuffer.slice(0, CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                        session.dgSocket.send(chunkToSend);
                        session.vadDeepgramBuffer = session.vadDeepgramBuffer.slice(CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                        session.audioStartTime = Date.now();
                    }
                }
            }
        } catch (err) {
            console.error(`Session ${session.id}: VAD output parse error:`, err);
        }
    });

    // Connect to Deepgram
    connectToDeepgram(session);

    // Send initial announcement
    sendInitialAnnouncement(session);
}

// Connect to Deepgram
function connectToDeepgram(session) {
    if (session.dgSocket && session.dgSocket.readyState === 1) {
        session.dgSocket.close();
    }

    session.dgSocket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-3&language=en&punctuate=true&interim_results=true&endpointing=200`,
        ['token', `${process.env.DEEPGRAM_API}`]
    );

    session.dgSocket.on('open', () => {
        console.log(`Session ${session.id}: ✅ Deepgram connected.`);
    });

    session.dgSocket.on('message', async (data) => {
        try {
            const received = JSON.parse(data);
            const transcript = received.channel?.alternatives?.[0]?.transcript;

            if (!transcript) return;

            if (session.isAIResponding && (Date.now() - session.lastInterruptionTime > session.interruptionCooldown)) {
                console.log(`Session ${session.id}: VAD detected speech during AI response. Initiating interruption.`);
                handleInterruption(session);
                session.lastInterruptionTime = Date.now();
            }

            if (received.is_final) {
                session.isTalking = true
                session.isSpeaking = false;
                session.lastInterimTranscript = '';

                session.currentUserUtterance += (session.currentUserUtterance ? ' ' : '') + transcript;
                console.log(`Session ${session.id}: Received final segment. Current utterance: "${session.currentUserUtterance}"`);

                if (session.chatHistory.length > 8) {
                    session.chatHistory.shift()
                }
                const messagesForDetection = [
                    ...session.chatHistory,
                    { role: 'user', content: session.currentUserUtterance }
                ];
                // console.log(messagesForDetection);
                // let turnTimeStart = Date.now()

                // turnDetector.CheckEndOfTurn({ messages: messagesForDetection }, (err, response) => {
                //     (async () => {
                //         let turnTime = Date.now() - turnTimeStart
                //         console.log("turnTime", turnTime)
                //         if (err) {
                //             console.error('❌ gRPC Error:', err);
                //         } else {
                //             if (response.end_of_turn) {
                //                 console.log(`Session ${session.id}: ✅ Turn complete. Waiting for more input.`);
                //                 if (!session.isVadSpeechActive) {
                //                     await handleTurnCompletion(session);
                //                 }
                //             } else {
                //                 console.log(`Session ${session.id}: ⏳ Turn NOT complete. Waiting for more input.`);
                //                 session.isTalking = false
                //                 setTimeout(async () => {
                //                     if (!session.isTalking && !session.isVadSpeechActive) {
                //                         await handleTurnCompletion(session)
                //                     }
                //                 }, 1000)
                //             }
                //         }
                //     })();
                // });
                let end = detectTurnEnd(session.currentUserUtterance)
                console.log("end", end)
                if (end) {
                    if (!session.isVadSpeechActive) {
                        await handleTurnCompletion(session);
                    }
                }
                else {
                    // console.log("turn not complete")
                    session.isTalking = false

                    setTimeout(async () => {
                        if (!session.isTalking && !session.isVadSpeechActive) {
                            await handleTurnCompletion(session)
                        }
                    }, 1000)
                }
            } else {
                if (transcript.trim() && transcript !== session.lastInterimTranscript) {
                    session.isSpeaking = true;
                    session.lastInterimTranscript = transcript;
                    // Send interim transcript to client via LiveKit data channel
                    // session.room.localParticipant.publishData(
                    //     Buffer.from(JSON.stringify({
                    //         type: 'interim_transcript',
                    //         transcript: transcript
                    //     })),
                    //     { topic: 'transcript' }
                    // );
                }
            }
        } catch (err) {
            console.error(`Session ${session.id}: Deepgram message parse error:`, err);
        }
    });

    session.dgSocket.on('error', (err) => {
        console.error(`Session ${session.id}: Deepgram error:`, err);
    });

    session.dgSocket.on('close', () => {
        console.log(`Session ${session.id}: Deepgram connection closed.`);
    });
}

// Handle turn completion
async function handleTurnCompletion(session) {
    const finalTranscript = session.currentUserUtterance;
    if (!finalTranscript) return;

    session.chatHistory.push({ role: 'user', content: finalTranscript });
    session.currentUserUtterance = '';

    // Send final transcript to client
    // session.room.localParticipant.publishData(
    //     Buffer.from(JSON.stringify({
    //         type: 'final_transcript',
    //         transcript: finalTranscript,
    //         isFinal: true
    //     })),
    //     { topic: 'transcript' }
    // );

    try {
        let LlmprocessTimeStart = Date.now()
        const { processedText, outputType } = await aiProcessing.processInput(
            { message: finalTranscript, input_channel: 'audio' },
            session
        );
        let LlmprocessTime = Date.now() - LlmprocessTimeStart
        console.log("Llm", LlmprocessTime)
        session.chatHistory.push({ role: 'assistant', content: processedText });

        if (outputType === 'audio') {
            handleInterruption(session);
            // let TTSTimeStart = Date.now()
            // const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
            // let TTSTime = Date.now() - TTSTimeStart
            // console.log("TTSTime", TTSTime)
            // if (!audioBuffer) throw new Error("Failed to synthesize speech.");
            // // let convertTimeStart = Date.now()
            // // const mulawBuffer = await audioUtils.convertMp3ToPcmInt16(audioBuffer, session.id);
            // // let convertTime = Date.now() - convertTimeStart
            // // console.log("convertTime", convertTime)
            // if (audioBuffer) {
            //     session.interruption = false;
            //     audioUtils.streamMulawAudioToLiveKit(session.room, audioBuffer, session);
            // } else {
            //     throw new Error("Failed to convert audio to mulaw.");
            // }
            await aiProcessing.processTextToSpeech(processedText, session);
        } else {
            session.room.localParticipant.publishData(
                Buffer.from(JSON.stringify({
                    type: 'text_response',
                    content: processedText,
                    latency: session.metrics
                })),
                {
                    topic: 'chat',
                    reliable: true
                }
            );
            session.isAIResponding = false;
        }
    } catch (err) {
        console.error(`Session ${session.id}: Error during turn completion handling:`, err);
        // session.room.localParticipant.publishData(
        //     Buffer.from(JSON.stringify({ type: 'error', error: err.message })),
        //     { topic: 'error' }
        // );
        session.isAIResponding = false;
    }
}

// Handle interruption
function handleInterruption(session) {
    if (!session || !session.isAIResponding) return;

    console.log(`Session ${session.id}: Handling interruption.`);

    if (session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
        try {
            session.currentAudioStream.stop();
        } catch (error) {
            console.error(`Session ${session.id}: Error stopping current audio stream:`, error);
        }
        session.currentAudioStream = null;
    }

    session.isAIResponding = false;
    session.interruption = true;

    setTimeout(() => {
        session.interruption = false;
        console.log(`Session ${session.id}: Interruption cooldown finished.`);
    }, session.interruptionCooldown);
}

// Send initial announcement
async function sendInitialAnnouncement(session) {
    let announcementText = session.chatHistory[0].content;

    // await audioUtils.deepgramTtsToLiveKit(session.room, announcementText, session);
    // const mp3Buffer = await aiProcessing.synthesizeSpeech(announcementText, session.id);
    // if (mp3Buffer) {
    //     // const mulawBuffer = await audioUtils.convertMp3ToPcmInt16(mp3Buffer, session.id);
    //     // if (mulawBuffer) {
    //     audioUtils.streamMulawAudioToLiveKit(session.room, mp3Buffer, session);
    //     // }
    // }
    await aiProcessing.processTextToSpeech(announcementText, session);
}

// Handle chat messages
// app.post('/chat', async (req, res) => {
//     try {
//         const { roomName, message } = req.body;

//         if (!roomName || !message) {
//             return res.status(400).json({ error: 'roomName and message are required' });
//         }

//         const session = sessionManager.getSession(roomName);
//         if (!session) {
//             return res.status(404).json({ error: 'Session not found' });
//         }

//         if (!session.availableChannel.includes("chat")) {
//             setChannel(session, "chat")
//         }

//         const { processedText, outputType } = await aiProcessing.processInput(
//             { message: message, input_channel: 'chat' },
//             session
//         );

//         if (outputType === 'chat') {
//             // session.room.localParticipant.publishData(
//             //     Buffer.from(JSON.stringify({
//             //         type: 'text_response',
//             //         content: processedText,
//             //         latency: session.metrics
//             //     })),
//             //     { topic: 'chat' }
//             // );

//             res.json({ success: true, response: processedText });


//         } else if (outputType === 'audio') {
//             const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
//             if (audioBuffer) {
//                 const mulawBuffer = await audioUtils.convertMp3ToPcmInt16(audioBuffer, session.id);
//                 if (mulawBuffer) {
//                     audioUtils.streamMulawAudioToLiveKit(session.room, mulawBuffer, session);
//                 }
//             }
//             res.json({ success: true });
//         }
//     } catch (error) {
//         console.error('Error processing chat message:', error);
//         res.status(500).json({ error: 'Failed to process chat message' });
//     }
// });

// Change prompt
app.post('/change-prompt', async (req, res) => {
    try {
        // console.log("initiated")
        const { userData, prompt, tools } = req.body;

        let user = userStorage.findUser(userData);
        if (!user) {
            return res.status(400).json({ error: 'user is required' });
        }
        const session = sessionManager.getSession(user.ActiveSessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        changePrompt(session, prompt, tools);
        console.log(session.prompt)

        res.json({
            success: true,
            message: 'Prompt updated successfully',
            prompt: session.prompt,
            functions: toolDefinitions
        });
    } catch (error) {
        console.error('Error changing prompt:', error);
        res.status(500).json({ error: 'Failed to change prompt' });
    }
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`✅ LiveKit server started on port ${PORT}`);
});

// Process Termination Handler
process.on('SIGINT', () => {
    console.log('\nServer shutting down. Cleaning up all sessions...');
    sessionManager.sessions.forEach((s, sessionId) => {
        sessionManager.cleanupSession(sessionId);
    });
    setTimeout(() => {
        process.exit(0);
    }, 500);
});




















// Web Socket Part

const wss = new WebSocket.Server({ port: 5002 });
console.log("✅ WebSocket server started on ws://localhost:5002");

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
    console.log("🎧 New client connected.");
    let sessionId = null; // Will be set once 'start' event is received
    let session = null; // Reference to the session object

    // Global interval to keep Deepgram connections alive for ALL active sessions
    const deepgramKeepAliveInterval = setInterval(() => {
        sessionManager.sessions.forEach(s => {
            if (s.dgSocket?.readyState === WebSocket.OPEN) {
                s.dgSocket.send(JSON.stringify({ type: "KeepAlive" }));
            }
        });
    }, 10000); // Send keep-alive every 10 seconds

    async function handleTurnCompletion(session) {
        const finalTranscript = session.currentUserUtterance;
        if (!finalTranscript) return; // Do nothing if there's no transcript

        // console.log(`Session ${session.id}: Turn complete. Processing final transcript: "${finalTranscript}"`);

        // 1. Add the complete user message to the official chat history
        session.chatHistory.push({ role: 'user', content: finalTranscript });

        // 2. Reset the utterance buffer for the next turn
        session.currentUserUtterance = '';

        // 3. Send final transcript to client for display (optional, but good practice)
        ws.send(JSON.stringify({
            type: 'final_transcript',
            transcript: finalTranscript,
            isFinal: true
        }));

        try {
            // 4. Get the AI's response
            const { processedText, outputType } = await aiProcessing.processInput(
                { message: finalTranscript, input_channel: 'audio' },
                session
            );

            // 5. Add AI response to chat history
            session.chatHistory.push({ role: 'assistant', content: processedText });

            if (outputType === 'audio') {
                // Your existing audio response logic
                handleInterruption(session); // Stop any ongoing AI speech
                const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
                if (!audioBuffer) throw new Error("Failed to synthesize speech.");

                const mulawBuffer = await audioUtils.convertMp3ToMulaw(audioBuffer, session.id);
                if (mulawBuffer) {
                    session.interruption = false;
                    audioUtils.streamMulawAudioToTwilio(ws, session.streamSid, mulawBuffer, session);
                } else {
                    throw new Error("Failed to convert audio to mulaw.");
                }
            } else {
                // Handle text output
                ws.send(JSON.stringify({
                    event: 'media',
                    type: 'text_response',
                    media: { payload: processedText },
                    latency: session.metrics
                }));
                session.isAIResponding = false;
            }
        } catch (err) {
            console.error(`Session ${session.id}: Error during turn completion handling:`, err);
            ws.send(JSON.stringify({ type: 'error', error: err.message }));
            session.isAIResponding = false;
        }
    }

    // REFACTORED: Your connectToDeepgram function with turn detection integrated.
    const connectToDeepgram = (currentSession) => { // Pass 'ws' as an argument
        if (!currentSession || !currentSession.id) {
            console.error('Attempted to connect to Deepgram without a valid session.');
            return;
        }

        if (currentSession.dgSocket && currentSession.dgSocket.readyState === WebSocket.OPEN) {
            currentSession.dgSocket.close();
        }

        currentSession.dgSocket = new WebSocket(
            `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-3&language=en&punctuate=true&interim_results=true&endpointing=200`,
            ['token', `${process.env.DEEPGRAM_API}`]
        );

        currentSession.dgSocket.on('open', () => {
            console.log(`Session ${currentSession.id}: ✅ Deepgram connected.`);
        });

        currentSession.dgSocket.on('message', async (data) => {
            try {
                const received = JSON.parse(data);
                const transcript = received.channel?.alternatives?.[0]?.transcript;

                if (!transcript) return;

                if (currentSession.isAIResponding && (Date.now() - currentSession.lastInterruptionTime > currentSession.interruptionCooldown)) {
                    console.log(`Session ${currentSession.id}: VAD detected speech during AI response. Initiating interruption.`);
                    handleInterruption(currentSession);
                    currentSession.lastInterruptionTime = Date.now();
                }

                // --- THIS IS THE CORE LOGIC CHANGE ---
                if (received.is_final) {
                    // A segment of speech has ended. We now check if it completes the user's turn.
                    currentSession.isTalking = true
                    currentSession.isSpeaking = false;
                    currentSession.lastInterimTranscript = '';

                    // 1. Append the new final segment to the ongoing utterance buffer.
                    currentSession.currentUserUtterance += (currentSession.currentUserUtterance ? ' ' : '') + transcript;
                    console.log(`Session ${currentSession.id}: Received final segment. Current utterance: "${currentSession.currentUserUtterance}"`);

                    // 2. Prepare the conversation history for the turn detector.
                    if (currentSession.chatHistory.length > 8) {
                        currentSession.chatHistory.shift()
                    }
                    const messagesForDetection = [
                        ...currentSession.chatHistory,
                        { role: 'user', content: currentSession.currentUserUtterance }
                    ];
                    console.log(messagesForDetection);

                    // 3. Ask the service if the turn is complete.
                    // const isComplete = await turnDetector.CheckEndOfTurn({ messages: messagesForDetection })

                    turnDetector.CheckEndOfTurn({ messages: messagesForDetection }, (err, response) => {
                        (async () => {
                            if (err) {
                                console.error('❌ gRPC Error:', err);
                            } else {
                                if (response.end_of_turn) {
                                    // YES, the turn is complete. Process the full utterance.
                                    console.log(`Session ${currentSession.id}: ✅ Turn complete. Waiting for more input.`);
                                    if (!currentSession.isVadSpeechActive) {
                                        await handleTurnCompletion(currentSession);

                                    }
                                } else {
                                    // NO, the user just paused. Wait for them to continue.
                                    console.log(`Session ${currentSession.id}: ⏳ Turn NOT complete. Waiting for more input.`);
                                    currentSession.isTalking = false
                                    setTimeout(async () => {
                                        if (!currentSession.isTalking && !currentSession.isVadSpeechActive) {
                                            await handleTurnCompletion(currentSession)
                                        }
                                    }, 5000)
                                }
                            }
                        })();
                    });

                    // if (isComplete.end_of_turn) {
                    //     // YES, the turn is complete. Process the full utterance.
                    //     await handleTurnCompletion(currentSession);
                    // } else {
                    //     // NO, the user just paused. Wait for them to continue.
                    //     console.log(`Session ${currentSession.id}: ⏳ Turn NOT complete. Waiting for more input.`);
                    // }

                } else { // This is an interim result.
                    // Interim logic remains the same - it's great for UI feedback.
                    if (transcript.trim() && transcript !== currentSession.lastInterimTranscript) {
                        currentSession.isSpeaking = true;
                        currentSession.lastInterimTranscript = transcript;
                        ws.send(JSON.stringify({
                            type: 'interim_transcript',
                            transcript: transcript
                        }));
                    }
                }
            } catch (err) {
                console.error(`Session ${currentSession.id}: Deepgram message parse error:`, err);
            }
        });

        currentSession.dgSocket.on('error', (err) => {
            console.error(`Session ${currentSession.id}: Deepgram error:`, err);
        });

        currentSession.dgSocket.on('close', () => {
            console.log(`Session ${currentSession.id}: Deepgram connection closed.`);
        });
    };

    // Function to handle Deepgram reconnection for a specific session
    const handleDeepgramReconnect = (currentSession) => {
        if (!currentSession || !currentSession.id) return; // Defensive check

        if (currentSession.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
            currentSession.reconnectAttempts++;
            console.log(`Session ${currentSession.id}: Reconnecting to Deepgram (${currentSession.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(() => connectToDeepgram(currentSession), CONFIG.RECONNECT_DELAY);
        } else {
            console.error(`Session ${currentSession.id}: Max Deepgram reconnection attempts reached. Terminating session.`);
            ws.send(JSON.stringify({ error: 'Failed to connect to transcription service. Ending call.' }));
            ws.close(); // Close the Twilio WebSocket, prompting Twilio to hang up
        }
    };

    // Function to handle interruption of AI speech
    const handleInterruption = (currentSession) => {
        if (!currentSession || !currentSession.isAIResponding) return;

        console.log(`Session ${currentSession.id}: Handling interruption.`);

        // Stop any ongoing audio stream for this session
        if (currentSession.currentAudioStream && typeof currentSession.currentAudioStream.stop === 'function') {
            try {
                currentSession.currentAudioStream.stop();
            } catch (error) {
                console.error(`Session ${currentSession.id}: Error stopping current audio stream:`, error);
            }
            currentSession.currentAudioStream = null;
        }

        // Send a few small silence buffers to Twilio to quickly "cut off" any remaining audio
        // This is a common trick to ensure prompt interruption.
        for (let i = 0; i < 3; i++) {
            const silenceBuffer = audioUtils.generateSilenceBuffer(10); // 10ms silence
            try {
                ws.send(JSON.stringify({
                    event: 'media',
                    streamSid: currentSession.streamSid,
                    media: { payload: silenceBuffer.toString('base64') }
                }));
            } catch (error) {
                console.error(`Session ${currentSession.id}: Error sending silence buffer during interruption:`, error);
            }
        }

        currentSession.isAIResponding = false;
        currentSession.interruption = true; // Set flag to prevent new audio from starting immediately

        // Reset interruption flag after a short cooldown
        setTimeout(() => {
            currentSession.interruption = false;
            console.log(`Session ${currentSession.id}: Interruption cooldown finished.`);
        }, currentSession.interruptionCooldown);
    };

    // Main message handler for the Twilio WebSocket connection
    ws.on('message', async (data) => {
        try {
            const parsedData = JSON.parse(data);

            if (parsedData.event === 'start') {
                // console.log('start',parsedData);
                let userData = parsedData.start?.customParameters?.caller || parsedData.userData;
                session = sessionManager.createSession(ws, userData); // Pass ws to session manager
                sessionId = session.id;
                session.callSid = parsedData.start?.callSid;
                session.streamSid = parsedData?.streamSid; // Confirm streamSid in session
                session.caller = parsedData.start?.customParameters?.caller;
                // console.log(session.caller);
                console.log(`Session ${sessionId}: Twilio stream started for CallSid: ${session.callSid}`);
                ws.send(JSON.stringify({
                    type: "current_prompt",
                    streamSid: session.streamSid,
                    prompt: session.prompt,
                    functions: toolDefinitions
                }))
                // console.log(parsedData.caller);

                // Initialize per-session FFmpeg and VAD processes
                session.ffmpegProcess = spawn('ffmpeg', [
                    '-loglevel', 'quiet',
                    '-f', 'mulaw', // Input format from Twilio
                    '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(), // Input sample rate from Twilio
                    '-ac', '1', // Input channels
                    '-i', 'pipe:0', // Input from stdin
                    '-f', 's16le', // Output format for VAD/Deepgram
                    '-acodec', 'pcm_s16le', // Output codec
                    '-ar', CONFIG.SAMPLE_RATE.toString(), // Output sample rate for VAD/Deepgram
                    '-ac', '1', // Output channels
                    'pipe:1' // Output to stdout
                ]);


                // session.ffmpegProcess = spawn('ffmpeg', [
                //     '-loglevel', 'quiet',
                //     '-f', 'mulaw',
                //     '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(),
                //     '-ac', '1',
                //     '-i', 'pipe:0',
                //     '-f', 's16le',
                //     '-acodec', 'pcm_s16le',
                //     '-ar', CONFIG.DENOISER_RATE.toString(),   // 48 000 Hz for RNNoise
                //     '-ac', '1',
                //     'pipe:1',
                // ]);

                // console.log("ffmpeg initiated")

                // session.denoiser = NoiseCancellation();
                // console.log(session.denoiser)
                // session.remainder = Buffer.alloc(0); // Store partial frame chunks



                // const denoiseStream = new Transform({
                //     transform(chunk, _enc, cb) {
                //         // Combine leftover and new chunk
                //         chunk = Buffer.concat([session.remainder, chunk]);

                //         const cleaned = [];
                //         while (chunk.length >= 960) { // 480 samples = 960 bytes
                //             const frame = chunk.subarray(0, 960);
                //             chunk = chunk.subarray(960);
                //             cleaned.push(session.denoiser.process(frame)); // Denoise!
                //         }

                //         session.remainder = chunk; // Store any remaining < 960 bytes
                //         this.push(Buffer.concat(cleaned)); // Push clean PCM
                //         cb();
                //     },
                //     flush(cb) {
                //         // Pad and process remaining audio
                //         if (session.remainder.length) {
                //             const padded = Buffer.alloc(960);
                //             session.remainder.copy(padded);
                //             this.push(session.denoiser.process(padded));
                //         }
                //         cb();
                //     }
                // });

                session.vadProcess = spawn(process.env.PYTHON_PATH || 'python3', ['vad.py']); // Use env var for Python path
                session.ffmpegProcess.stdout.pipe(session.vadProcess.stdin); // Pipe FFmpeg output to VAD input
                // session.ffmpegProcess.stdout
                //     .pipe(denoiseStream) // Clean 48k Int16 PCM
                //     .pipe(session.vadProcess.stdin);


                // Attach VAD listener specific to this session
                session.vadProcess.stdout.on('data', (vadData) => {
                    // console.log("getting audio")
                    try {
                        const parsedVAD = JSON.parse(vadData.toString());
                        if (parsedVAD.event === 'speech_start') {
                            session.isVadSpeechActive = true;
                            console.log(`Session ${session.id}: VAD detected Speech START. Resetting Deepgram buffer.`);
                            session.vadDeepgramBuffer = Buffer.alloc(0); // Clear any old buffered audio
                        } else if (parsedVAD.event === 'speech_end') {
                            session.isVadSpeechActive = false;
                            console.log(`Session ${session.id}: VAD detected Speech END.`);
                            // When speech ends, send any remaining buffered audio to Deepgram
                            if (session.vadDeepgramBuffer.length > 0 && session.dgSocket?.readyState === WebSocket.OPEN) {
                                session.dgSocket.send(session.vadDeepgramBuffer);
                                session.vadDeepgramBuffer = Buffer.alloc(0); // Clear buffer after sending
                            }
                            // Important: Send Deepgram a "Finalize" message when VAD detects speech end
                            if (session.dgSocket?.readyState === WebSocket.OPEN) {
                                console.log(`Session ${session.id}: Sending Deepgram Finalize message.`);
                                session.dgSocket.send(JSON.stringify({ "type": "Finalize" }));
                            }
                        }

                        if (parsedVAD.chunk) {
                            console.log("got the speech")
                            const audioBuffer = Buffer.from(parsedVAD.chunk, 'hex');
                            session.vadDeepgramBuffer = Buffer.concat([session.vadDeepgramBuffer, audioBuffer]);
                            // The key is to send frequently, not wait for a large chunk.
                            if (session.isVadSpeechActive && session.dgSocket?.readyState === WebSocket.OPEN) {
                                while (session.vadDeepgramBuffer.length >= CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE) {
                                    const chunkToSend = session.vadDeepgramBuffer.slice(0, CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                                    session.dgSocket.send(chunkToSend);
                                    session.vadDeepgramBuffer = session.vadDeepgramBuffer.slice(CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                                    session.audioStartTime = Date.now(); // Mark time when audio is sent
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Session ${session.id}: VAD output parse error:`, err);
                    }
                });

                // Handle errors from FFmpeg and VAD processes for this session
                session.ffmpegProcess.stderr.on('data', (data) => {
                    // console.error(`Session ${sessionId}: FFmpeg stderr: ${data.toString()}`);
                });
                session.ffmpegProcess.on('error', (err) => {
                    console.error(`Session ${sessionId}: FFmpeg process error:`, err);
                });
                session.ffmpegProcess.on('close', (code) => {
                    if (code !== 0) console.warn(`Session ${sessionId}: FFmpeg process exited with code ${code}.`);
                });

                session.vadProcess.stderr.on('data', (data) => {
                    // console.error(`Session ${sessionId}: VAD stderr: ${data.toString()}`);
                });
                session.vadProcess.on('error', (err) => {
                    console.error(`Session ${sessionId}: VAD process error:`, err);
                });
                session.vadProcess.on('close', (code) => {
                    if (code !== 0) console.warn(`Session ${sessionId}: VAD process exited with code ${code}.`);
                });

                // Connect to Deepgram after processes are set up
                connectToDeepgram(session);

                // Send initial announcement

                // const userDetails = await functions.getUserDetailsByPhoneNo(session.caller);
                // console.log(userDetails);
                let announcementText = session.chatHistory[0].content; // Get initial message from chat history
                // if (userDetails) {
                //     announcementText = `Hello ${userDetails.firstName}, welcome to the Gautam Garments. How can I help you today?`;
                // }

                const mp3Buffer = await aiProcessing.synthesizeSpeech(announcementText, session.id);
                if (mp3Buffer) {
                    const mulawBuffer = await audioUtils.convertMp3ToMulaw(mp3Buffer, session.id);
                    if (mulawBuffer) {
                        audioUtils.streamMulawAudioToTwilio(ws, session.streamSid, mulawBuffer, session);
                    }
                }

            } else if (parsedData.event === 'media' && parsedData.media?.payload) {

                // console.log('mediaEvent : ',parsedData);
                // Ensure session exists and ffmpeg is ready to receive audio
                if (parsedData.type === 'chat') {
                    if (!session) {
                        console.error('No session ID available for chat message. Ignoring.');
                        return;
                    }
                    if (!session.availableChannel.includes("chat")) {
                        setChannel(session, "chat")

                    }
                    console.log(session.availableChannel)
                    console.log("chat recieved")
                    const { processedText, outputType } = await aiProcessing.processInput(
                        { message: parsedData.media.payload, input_channel: 'chat' },
                        session
                    );
                    console.log(processedText, outputType)

                    if (outputType === 'chat') {
                        ws.send(JSON.stringify({
                            event: 'media',
                            type: 'text_response',
                            media: { payload: processedText },
                            latency: session.metrics
                        }));
                    } else if (outputType === 'audio') {
                        const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
                        if (audioBuffer) {
                            const mulawBuffer = await audioUtils.convertMp3ToMulaw(audioBuffer, session.id);
                            if (mulawBuffer) {
                                audioUtils.streamMulawAudioToTwilio(ws, session.streamSid, mulawBuffer, session);
                            }
                        }
                    }
                }
                else if (session && session.ffmpegProcess && session.ffmpegProcess.stdin.writable) {
                    // console.log("event called")
                    if (!session.availableChannel.includes("audio")) {
                        setChannel(session, "audio")
                    }
                    const audioBuffer = Buffer.from(parsedData.media.payload, 'base64');
                    // console.log(`Session ${session.id}: Writing ${audioBuffer.length} bytes to FFmpeg`);
                    session.ffmpegProcess.stdin.write(audioBuffer); // Write to this session's ffmpeg
                } else {
                    // console.warn(`Session ${sessionId}: Media received but ffmpeg not ready or session not found.`);
                }
            } else if (parsedData.event === 'change_prompt') {
                console.log('session', session.streamSid)
                console.log('prompt', parsedData.prompt)
                changePrompt(session, parsedData.prompt, parsedData.tools, ws)
            }
            // Add other event types if necessary (e.g., 'stop', 'mark')
        } catch (err) {
            console.error(`Session ${sessionId}: Error processing Twilio WebSocket message:`, err);
        }
    });

    ws.on('close', () => {
        console.log(`Session ${sessionId}: Twilio client disconnected.`);
        // if (sessionId) {
        //     sessionManager.deleteSession(sessionId);
        // }
        clearInterval(deepgramKeepAliveInterval); // Clear keep-alive for this WS
    });

    ws.on('error', (error) => {
        console.error(`Session ${sessionId}: Twilio client error:`, error);
        if (sessionId) {
            sessionManager.cleanupSession(sessionId); // Cleanup on error
        }
        clearInterval(deepgramKeepAliveInterval); // Clear keep-alive for this WS
    });
});

// Process Termination Handler for the main server process
process.on('SIGINT', () => {
    console.log('\nServer shutting down. Cleaning up all sessions...');
    sessionManager.sessions.forEach((s, sessionId) => {
        sessionManager.cleanupSession(sessionId);
    });
    // Give a small moment for processes to terminate
    setTimeout(() => {
        wss.close(() => {
            console.log('WebSocket server closed.');
            process.exit(0);
        });
    }, 500);
});