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

// LiveKit imports
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room, RoomEvent, RemoteParticipant, LocalParticipant, AudioPresets, VideoPresets, TrackSource, AudioSource, LocalAudioTrack, AudioFrame, TrackKind, AudioStream } = require('@livekit/rtc-node');

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

// Session Management
class SessionManager {
    constructor() {
        this.sessions = new Map(); // Stores active sessions by roomName
    }

    createSession(roomName, room) {
        if (this.sessions.has(roomName)) {
            console.warn(`Session ${roomName}: already exists, re-creating.`);
            this.cleanupSession(roomName);
        }

        const session = {
            id: roomName,
            room: room,
            dgSocket: null,
            reconnectAttempts: 0,
            lastTranscript: '',
            transcriptBuffer: [],
            audioStartTime: null,
            userPhoneno: null,
            lastInterimTime: Date.now(),
            isSpeaking: false,
            lastInterimTranscript: '',
            interimResultsBuffer: [],
            userSpeak: false,
            streamSid: roomName,
            callSid: '',
            isAIResponding: false,
            currentAudioStream: null,
            interruption: false,
            lastInterruptionTime: 0,
            interruptionCooldown: 200,
            ASSISTANT_ID: null,
            lastResponseId: null,
            threadId: null,
            phoneNo: '',
            currentMessage: {},
            availableChannel: [],
            chatHistory: [{
                role: 'assistant',
                content: "Hello! You are speaking to an AI assistant for Gautam Garment."
            }],
            prompt: `You are a helpful AI assistant for the Shopify store "Gautam Garment". You have access to several tools (functions) that let you fetch and provide real-time information about products, orders, and customers from the store.

Your Tasks:

Understand the user's message and intent.
If you need specific store data (like product lists, order details, or customer info), use the available tools by calling the appropriate function with the required parameters.
After receiving tool results, use them to generate a helpful, concise, and accurate response for the user.
Always return your answer in JSON format with two fields:
"response": your textual reply for the user
"output_channel": the medium for your response

Example Output:
{
"response": "Here are the top 5 products from Gautam Garment.",
"output_channel": "audio"
}

User Input Format:
The user's message will be a JSON object with "message" and "input_channel", for example:
{
"message": "Show me my recent orders",
"input_channel": "audio"
}

Available Tools (functions):
getAllProducts: Get a list of all products in the store.
getUserDetailsByPhoneNo: Get customer details by phone number.
getAllOrders: Get a list of all orders.
getOrderById: Get details for a specific order by its ID.

Instructions:
If a user's request requires store data, call the relevant tool first, then use its result in your reply.
If the user asks a general question or your response does not require real-time store data, answer directly.
Always use the user's input_channel for your response if it matches the available output channels.
The store name is "Gautam Garment"—refer to it by name in your responses when appropriate.`,
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
        this.sessions.set(roomName, session);
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
                // console.log(`Session ${sessionId}: FFmpeg stderr for conversion:`, data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(mulawBuffer);
                } else {
                    console.error(`Session ${sessionId}: FFmpeg process failed with code ${code} during MP3 to Mulaw conversion.`);
                    reject(new Error(`ffmpeg process failed with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                console.error(`Session ${sessionId}: FFmpeg process error during MP3 to Mulaw conversion:`, err);
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
                    console.error(`❌ FFmpeg error: ${errorOutput}`);
                    reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
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

        const stopFunction = () => {
            console.log(`Session ${session.id}: Stopping outgoing audio stream...`);
            session.interruption = true;
            session.isAIResponding = false;
            offset = mulawBuffer.length;
            session.currentAudioStream = null;
        };

        session.currentAudioStream = { stop: stopFunction };

        async function sendChunk() {
            if (offset >= mulawBuffer.length || session.interruption) {
                console.log(`Session ${session.id}: Audio stream ended or interrupted.`);
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
                const source = new AudioSource(16000, 1);
                const track = LocalAudioTrack.createAudioTrack('ai-response', source);

                await room.localParticipant.publishTrack(track, {
                    source: TrackSource.SOURCE_MICROPHONE,
                    name: 'ai-response'
                });

                console.log(`🎵 Track published to room: ${room}`);

                const CHUNK_SIZE = 480; // 30ms at 16kHz
                const chunks = [];

                for (let i = 0; i < pcm.length; i += CHUNK_SIZE) {
                    const chunk = pcm.slice(i, i + CHUNK_SIZE);
                    chunks.push(chunk);
                }

                console.log(`🎵 Streaming ${chunks.length} audio chunks`);

                // Stream chunks with proper timing
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const audioFrame = new AudioFrame(chunk, 16000, 1, chunk.length);

                    await source.captureFrame(audioFrame);

                    // Wait for the chunk duration before sending next chunk
                    if (i < chunks.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 30));
                    }
                }

                console.log(`✅ Audio streaming completed for room: ${room}`);
                // Send audio data to LiveKit room
                // This would need to be implemented based on LiveKit's audio publishing API
                // For now, we'll use a placeholder
                console.log(`Session ${session.id}: Sending audio chunk to LiveKit`);
                offset += CHUNK_SIZE_MULAW;
                // setTimeout(sendChunk, 100);
            } catch (error) {
                console.error(`Session ${session.id}: Error sending audio chunk:`, error);
                stopFunction();
            }
        }
        sendChunk();
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
            // tools: session.tools
            tools: toolDefinitions
        };
        if (session.lastResponseId) {
            createResponseParams.previous_response_id = session.lastResponseId;
        }

        let response = await services.openai.responses.create(createResponseParams);
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

        const messages = response.output || [];
        const assistantMessage = messages.find(m => m.role === "assistant");

        let parsedData;
        try {
            parsedData = JSON.parse(assistantMessage.content[0].text);
            return { processedText: parsedData.response, outputType: parsedData.output_channel };
        } catch (error) {
            return {
                processedText: assistantMessage.content[0].text || "Sorry, I had trouble understanding. Could you please rephrase?",
                outputType: session.availableChannel[0]
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
                    'Authorization': `Bearer ${process.env.GABBER_USAGETOKEN}`,
                },
                body: JSON.stringify({
                    text,
                    voice_id: process.env.GABBER_VOICEID_MALE,
                })
            });

            const latency = Date.now() - startTime;
            console.log(`Session ${sessionId}: TTS Latency: ${latency}ms`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`❌ Gabber API failed [${response.status}]: ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);

        } catch (err) {
            const raw = err.response?.data;
            const decoded = raw && Buffer.isBuffer(raw)
                ? raw.toString()
                : JSON.stringify(raw);

            console.error(`Session ${sessionId}: Speech synthesis error with Gabber:`, decoded || err.message);
            throw err;
        }
    },

    async synthesizeSpeech(text, sessionId) {
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
                console.log(`Session ${sessionId}: TTS Latency: ${latency}ms`);
                return audioBuffer;
            }
            throw new Error("AudioStream not found in Polly response.");
        } catch (err) {
            console.error(`Session ${sessionId}: Speech synthesis error with Polly:`, err);
            throw err;
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
            identity: participantName,
            ttl: 36000
        });
        at.addGrant({ roomJoin: true, room: roomName });

        res.json({ token: at.toJwt() });
    } catch (error) {
        console.error('Error generating token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// Create room and join as agent
app.post('/create-room', async (req, res) => {
    try {
        const { roomName } = req.body;

        if (!roomName) {
            return res.status(400).json({ error: 'roomName is required' });
        }

        // Create room
        await roomService.createRoom({
            name: roomName,
            emptyTimeout: 10 * 60, // 10 minutes
            maxParticipants: 2,
        });

        // Join room as agent
        const room = new Room();
        const agentToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: 'AI-Agent',
        });
        agentToken.addGrant({ roomJoin: true, room: roomName });

        await room.connect(LIVEKIT_URL, agentToken.toJwt(), {
            autoSubscribe: true
        });

        // Create session for this room
        const session = sessionManager.createSession(roomName, room);

        // Set up room event handlers
        setupRoomEventHandlers(room, session);

        res.json({
            success: true,
            roomName,
            message: 'Room created and agent joined successfully'
        });
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Setup room event handlers
function setupRoomEventHandlers(room, session) {
    room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log(`Session ${session.id}: Participant connected: ${participant.identity}`);

        // Initialize audio processing for this participant
        setupAudioProcessingForParticipant(participant, session);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log(`Session ${session.id}: Participant disconnected: ${participant.identity}`);
    });

    room.on(RoomEvent.Disconnected, () => {
        console.log(`Session ${session.id}: Room disconnected`);
        sessionManager.deleteSession(session.id);
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        handleTrackSubscribed(track, publication, participant, session);
    });

    room.on(RoomEvent.ChatMessage, (message,participant) => {
        // console.log(payload)
        handleChatInput(message, participant, session)
    })
}

async function handleChatInput(message, participant, session) {
    try {
        // if (!payload || payload.length === 0) {
        //     console.warn(`⚠️ Received empty payload from ${participant.identity}`);
        //     return;
        // }
        // console.log("payload", payload)
        console.log(message)
        const data = JSON.parse(message);
        console.log("data", data)
        if (data.type === 'chat') {
            console.log(`💬 Chat from ${participant.identity}: ${data.content}`);

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
        console.log(`Subscribed to ${participant.identity}'s audio track`);

        const stream = new AudioStream(track);
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
                console.log(messagesForDetection);

                turnDetector.CheckEndOfTurn({ messages: messagesForDetection }, (err, response) => {
                    (async () => {
                        if (err) {
                            console.error('❌ gRPC Error:', err);
                        } else {
                            if (response.end_of_turn) {
                                console.log(`Session ${session.id}: ✅ Turn complete. Waiting for more input.`);
                                if (!session.isVadSpeechActive) {
                                    await handleTurnCompletion(session);
                                }
                            } else {
                                console.log(`Session ${session.id}: ⏳ Turn NOT complete. Waiting for more input.`);
                                session.isTalking = false
                                setTimeout(async () => {
                                    if (!session.isTalking && !session.isVadSpeechActive) {
                                        await handleTurnCompletion(session)
                                    }
                                }, 5000)
                            }
                        }
                    })();
                });
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
        const { processedText, outputType } = await aiProcessing.processInput(
            { message: finalTranscript, input_channel: 'audio' },
            session
        );

        session.chatHistory.push({ role: 'assistant', content: processedText });

        if (outputType === 'audio') {
            handleInterruption(session);
            const audioBuffer = await aiProcessing.synthesizeSpeech(processedText, session.id);
            if (!audioBuffer) throw new Error("Failed to synthesize speech.");

            const mulawBuffer = await audioUtils.convertMp3ToPcmInt16(audioBuffer, session.id);
            if (mulawBuffer) {
                session.interruption = false;
                audioUtils.streamMulawAudioToLiveKit(session.room, mulawBuffer, session);
            } else {
                throw new Error("Failed to convert audio to mulaw.");
            }
        } else {
            // Handle text output
            session.room.localParticipant.publishData(
                Buffer.from(JSON.stringify({
                    type: 'text_response',
                    content: processedText,
                    latency: session.metrics
                })),
                { topic: 'chat' }
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

    // const mp3Buffer = await aiProcessing.synthesizeSpeech(announcementText, session.id);
    // if (mp3Buffer) {
    //     const mulawBuffer = await audioUtils.convertMp3ToPcmInt16(mp3Buffer, session.id);
    //     if (mulawBuffer) {
    //         audioUtils.streamMulawAudioToLiveKit(session.room, mulawBuffer, session);
    //     }
    // }
}

// Handle chat messages
app.post('/chat', async (req, res) => {
    try {
        const { roomName, message } = req.body;

        if (!roomName || !message) {
            return res.status(400).json({ error: 'roomName and message are required' });
        }

        const session = sessionManager.getSession(roomName);
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
            session.room.localParticipant.publishData(
                Buffer.from(JSON.stringify({
                    type: 'text_response',
                    content: processedText,
                    latency: session.metrics
                })),
                { topic: 'chat' }
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

        res.json({ success: true, response: processedText });
    } catch (error) {
        console.error('Error processing chat message:', error);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// Change prompt
app.post('/change-prompt', async (req, res) => {
    try {
        const { roomName, prompt, tools } = req.body;

        if (!roomName) {
            return res.status(400).json({ error: 'roomName is required' });
        }

        const session = sessionManager.getSession(roomName);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        changePrompt(session, prompt, tools);

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