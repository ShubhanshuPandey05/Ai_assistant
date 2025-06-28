// Core Dependencies
const { spawn } = require('child_process');
const WebSocket = require('ws');
require('dotenv').config(); // Make sure your .env file has all the necessary keys
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const OpenAI = require("openai");
const twilio = require('twilio'); // This might not be directly used in the WebSocket server, but kept for consistency
const fs = require('fs');
const path = require('path');

// LiveKit Egress Configuration
const EGRESS_CONFIG = {
    baseUrl: process.env.EGRESS_URL || 'http://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    wsUrl: process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL,
    tempDir: path.join(__dirname, 'temp'),
    recordingsDir: path.join(__dirname, 'recordings')
};

// Create directories if they don't exist
if (!fs.existsSync(EGRESS_CONFIG.tempDir)) {
    fs.mkdirSync(EGRESS_CONFIG.tempDir, { recursive: true });
}
if (!fs.existsSync(EGRESS_CONFIG.recordingsDir)) {
    fs.mkdirSync(EGRESS_CONFIG.recordingsDir, { recursive: true });
}

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-01/graphql.json`;
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './turn.proto';


const {
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    Room,
    RoomEvent,
    RemoteAudioTrack,
    Track,
    dispose,
} = require('@livekit/rtc-node');

const {
    AudioFrame,
    AudioSource,
    LocalAudioTrack,
    TrackPublishOptions,
    TrackSource,
} = require('@livekit/rtc-node');

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

        // console.log(products)

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

    // async getUserDetailsByPhoneNo(phone) {
    //     try {
    //         // console.log(`http://localhost:3000/getuser/search?${encodeURIComponent(phone)}`)
    //         const response = await fetch(`http://localhost:3000/getuser/search?phone=${encodeURIComponent(phone)}`);

    //         if (!response.ok) {
    //             console.error('User not found or error occurred:', response.status);
    //             return null;
    //         }

    //         const user = await response.json();
    //         console.log(user[0].name)
    //         return {
    //             id: user[0].user_id,
    //             name: user[0].name,
    //             email: user[0].email,
    //             phone: user[0].phone,// Optional, if you have this in DB
    //         };
    //     } catch (error) {
    //         console.error('❌ Error fetching user by phone from API:', error);
    //         return null;
    //     }
    // },

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
    // SILENCE_THRESHOLD: 500, // Not actively used in this VAD logic, but kept
    // INTERIM_CONFIDENCE_THRESHOLD: 0.7, // No longer used for immediate interim sending
    // INTERIM_TIME_THRESHOLD: 10, // No longer used for immediate interim sending
    // CHUNK_SIZE: 6400, // No longer used for Deepgram streaming, replaced by DEEPGRAM_STREAM_CHUNK_SIZE
    AUDIO_CHUNK_SIZE: 1600, // Mulaw audio chunk size for Twilio (8khz) - This is for sending to Twilio
    DEEPGRAM_STREAM_CHUNK_SIZE: 800, // 100ms of 16khz s16le audio for Deepgram (16000 samples/s * 0.1s * 2 bytes/sample)
    SAMPLE_RATE: 16000, // Sample rate for Deepgram and internal processing (linear16)
    AUDIO_SAMPLE_RATE: 8000, // Sample rate for Twilio (mulaw)
    POLLY_VOICE_ID: "Joanna",
    POLLY_OUTPUT_FORMAT: "mp3",
    GPT_MODEL: "gpt-4o-mini",
    GPT_MAX_TOKENS: 150,
    GPT_TEMPERATURE: 0.1
};

// Performance Monitoring (Global, as it aggregates stats from all sessions)
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
        this.sessions = new Map(); // Stores active sessions by streamSid
    }

    createSession(sessionId, ws) {
        if (this.sessions.has(sessionId)) {
            console.warn(`Session ${sessionId}: already exists, re-creating.`);
            this.cleanupSession(sessionId); // Clean up existing one if it somehow exists
        }

        const session = {
            id: sessionId,
            ws: ws, // Store the Twilio WebSocket for sending media
            dgSocket: null, // Deepgram WebSocket
            reconnectAttempts: 0,
            lastTranscript: '',
            transcriptBuffer: [],
            // silenceTimer: null, // Not used with current VAD/Deepgram approach
            audioStartTime: null, // For latency measurement
            userPhoneno: null,
            lastInterimTime: Date.now(),
            isSpeaking: false, // User speaking status from Deepgram's perspective
            lastInterimTranscript: '',
            interimResultsBuffer: [],
            userSpeak: false, // Flag when user has finished speaking
            streamSid: sessionId,
            callSid: '', // Will be populated from Twilio 'start' event
            isAIResponding: false, // AI currently speaking
            currentAudioStream: null, // Reference to the outgoing audio stream function
            interruption: false, // Flag for user interruption during AI speech
            lastInterruptionTime: 0,
            interruptionCooldown: 200,
            ASSISTANT_ID: null,
            lastResponseId: null,
            threadId: null,
            phoneNo: '',
            currentMessage: {},
            availableChannel: ['audio'], // Initialize with default channel
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

            // Per-session child processes for audio handling
            ffmpegProcess: null,
            vadProcess: null,
            turndetectionprocess: null,
            vadDeepgramBuffer: Buffer.alloc(0), // Buffer for audio chunks after VAD/FFmpeg processing
            isVadSpeechActive: false,
            currentUserUtterance: '', // VAD's internal speech detection status
            isTalking: false,
            tools: []
        };
        this.sessions.set(sessionId, session);
        console.log(`Session ${sessionId}: Created new session.`);
        return session;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.cleanupSession(sessionId);
            this.sessions.delete(sessionId);
            console.log(`Session ${sessionId}: Deleted session.`);
        }
    }

    cleanupSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            if (session.dgSocket?.readyState === WebSocket.OPEN) {
                session.dgSocket.close();
                console.log(`Session ${sessionId}: Closed Deepgram socket.`);
            }
            // if (session.silenceTimer) { // Not used with current VAD/Deepgram approach
            //     clearTimeout(session.silenceTimer);
            //     session.silenceTimer = null;
            // }
            // Terminate child processes
            if (session.ffmpegProcess) {
                session.ffmpegProcess.stdin.end(); // End stdin to allow process to exit gracefully
                session.ffmpegProcess.kill('SIGINT'); // Send SIGINT to gracefully terminate
                console.log(`Session ${sessionId}: Terminated ffmpeg process.`);
            }
            if (session.vadProcess) {
                session.vadProcess.stdin.end(); // End stdin
                session.vadProcess.kill('SIGINT'); // Send SIGINT
                console.log(`Session ${sessionId}: Terminated VAD process.`);
            }
            // Ensure any ongoing audio streaming is stopped
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
        // Generates a buffer of silence for mulaw 8khz, 1 channel
        const numSamples = Math.floor((durationMs / 1000) * sampleRate);
        return Buffer.alloc(numSamples); // mulaw is 8-bit, so 1 byte per sample
    },

    convertMp3ToMulaw(mp3Buffer, sessionId) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0', // Input from stdin
                '-f', 'mulaw', // Output format
                '-ar', CONFIG.AUDIO_SAMPLE_RATE.toString(), // Output sample rate
                '-ac', '1', // Output channels
                '-acodec', 'pcm_mulaw', // Output codec
                '-y', // Overwrite output files without asking
                'pipe:1' // Output to stdout
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
                    // console.log(`Session ${sessionId}: Audio conversion successful, buffer size:`, mulawBuffer.length);
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
                console.error(`Session ${session.id}: Error sending audio chunk:`, error);
                stopFunction(); // Stop on error
            }
        }
        sendChunk(); // Start sending chunks
    }
};

// AI Processing
const aiProcessing = {
    // async processInput(input, session) {
    //     try {
    //         session.currentMessage = input;
    //         session.chatHistory.push({ U: input.message });

    //         // Prepare messages for OpenAI
    //         const messages = [
    //             { role: "system", content: session.prompt },
    //             { role: "user", content: JSON.stringify({ chatHistory: session.chatHistory, currentMessage: session.currentMessage }) }
    //         ];

    //         const startTime = Date.now();
    //         const response = await services.openai.chat.completions.create({
    //             model: CONFIG.GPT_MODEL,
    //             messages: messages,
    //             temperature: CONFIG.GPT_TEMPERATURE,
    //             max_tokens: CONFIG.GPT_MAX_TOKENS,
    //             response_format: { type: "json_object" } // Request JSON object directly
    //         });
    //         const latency = Date.now() - startTime;
    //         session.metrics.llm = latency;

    //         let parsedData;
    //         try {
    //             parsedData = JSON.parse(response.choices[0].message.content);
    //             console.log(`Session ${session.id}: LLM Raw Response:`, response.choices[0].message.content);
    //             console.log(`Session ${session.id}: Parsed LLM response:`, parsedData.response);
    //             console.log(`Session ${session.id}: Parsed LLM output channel:`, parsedData.output_channel);
    //             session.chatHistory.push({ A: parsedData.response });
    //             return { processedText: parsedData.response, outputType: parsedData.output_channel };
    //         } catch (error) {
    //             console.error(`Session ${session.id}: Error parsing LLM JSON response:`, error);
    //             console.log(`Session ${session.id}: Attempting to use raw LLM content:`, response.choices[0].message.content);
    //             session.chatHistory.push({ A: response.choices[0].message.content });
    //             // Fallback if JSON parsing fails
    //             return {
    //                 processedText: response.choices[0].message.content || "Sorry, I had trouble understanding. Could you please rephrase?",
    //                 outputType: 'audio' // Default to audio if parsing fails
    //             };
    //         }
    //     } catch (error) {
    //         console.error(`Session ${session.id}: Error processing input with OpenAI:`, error);
    //         // Fallback for API errors
    //         return { processedText: "I'm having trouble connecting right now. Please try again later.", outputType: 'audio' };
    //     }
    // },

    async processInput(input, session) {
        // On the first user message, previous_response_id will be undefined.
        // On subsequent turns, set previous_response_id to maintain context.


        console.log("here are the sessions details :", session.prompt, session.tools)


        const createResponseParams = {
            model: "gpt-4o-mini", // required
            input: input.message, // required
            instructions: session.prompt,
            tools: session.tools
        };
        if (session.lastResponseId) {
            createResponseParams.previous_response_id = session.lastResponseId;
        }

        // Send the user's message to OpenAI
        let response = await services.openai.responses.create(createResponseParams);

        // Save the latest response ID for continuity
        session.lastResponseId = response.id;
        // console.log(response)

        if (response.output[0].type === "function_call") {
            const tool = []
            let toolResult;

            // Extract arguments from the function call with error handling
            let args = {};
            try {
                args = response.output[0].arguments ? JSON.parse(response.output[0].arguments) : {};
            } catch (parseError) {
                console.error(`Session ${session.id}: Error parsing function arguments:`, parseError);
                args = {};
            }

            if (response.output[0].name === "getAllProducts") {
                toolResult = await functions.getAllProducts();
            } else if (response.output[0].name === "getUserDetailsByPhoneNo") {
                // Use session.caller if available, otherwise use args.phone if provided
                const phoneNumber = session.caller || args.phone;
                if (!phoneNumber) {
                    toolResult = { error: "Phone number not provided" };
                } else {
                    toolResult = await functions.getUserDetailsByPhoneNo(phoneNumber);
                }
            } else if (response.output[0].name === "getAllOrders") {
                toolResult = await functions.getAllOrders();
            } else if (response.output[0].name === "getOrderById") {
                if (!args.orderId) {
                    toolResult = { error: "Order ID not provided" };
                } else {
                    toolResult = await functions.getOrderById(args.orderId);
                }
            } else {
                toolResult = { error: "Unknown tool requested." };
            }
            // console.log(toolResult)
            // console.log(response.output)

            tool.push({
                type: "function_call_output",
                call_id: response.output[0].call_id,
                output: JSON.stringify({ toolResult })
            });
            // console.log(message)
            response = await services.openai.responses.create({
                model: "gpt-4o-mini",
                instructions: session.prompt,
                input: tool,
                previous_response_id: session.lastResponseId // chain for context
            });
            session.lastResponseId = response.id;

        }




        // Extract the assistant's latest 


        // session.lastResponseId = response.id;

        const messages = response.output || [];
        const assistantMessage = messages.find(m => m.role === "assistant");

        let parsedData;
        try {
            if (assistantMessage && assistantMessage.content && assistantMessage.content[0] && assistantMessage.content[0].text) {
                parsedData = JSON.parse(assistantMessage.content[0].text);
                return { processedText: parsedData.response, outputType: parsedData.output_channel };
            } else {
                throw new Error("Invalid assistant message structure");
            }
        } catch (error) {
            console.error(`Session ${session.id}: Error parsing assistant message:`, error);
            const fallbackText = assistantMessage?.content?.[0]?.text || "Sorry, I had trouble understanding. Could you please rephrase?";
            return {
                processedText: fallbackText,
                outputType: session.availableChannel && session.availableChannel.length > 0 ? session.availableChannel[0] : 'audio'
            };
        }
    },



    // async synthesizeSpeech(text, sessionId) {
    //     if (!text) {
    //         console.error(`Session ${sessionId}: No text provided for synthesis.`);
    //         return null;
    //     }

    //     const startTime = Date.now();

    //     try {
    //         console.log(process.env.GABBER_USAGETOKEN)
    //         const response = await fetch('https://api.gabber.dev/v1/voice/generate', {
    //             method: 'POST',
    //             headers: {
    //                 'Content-Type': 'application/json',
    //                 // 'Authorization': `Bearer ${process.env.GABBER_USAGETOKEN}`,
    //                 'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTA5MzM3OTUsImh1bWFuIjoic3RyaW5nIiwicHJvamVjdCI6IjkzYTUyY2Y4LTNmYTQtNDhjYi1hYTMyLWJiMzkxNDQxZTI4NSJ9.JmDmRWLRgpDEljwwjnAlJtyumahM_KRYmwpp7OT9p5w`,
    //             },
    //             body: JSON.stringify({
    //                 text,
    //                 voice_id: process.env.GABBER_VOICEID_MALE,
    //             })
    //         });

    //         const latency = Date.now() - startTime;
    //         console.log(`Session ${sessionId}: TTS Latency: ${latency}ms`);

    //         if (!response.ok) {
    //             const errorText = await response.text();
    //             throw new Error(`❌ Gabber API failed [${response.status}]: ${errorText}`);
    //         }

    //         const arrayBuffer = await response.arrayBuffer();
    //         return Buffer.from(arrayBuffer);

    //     } catch (err) {
    //         const raw = err.response?.data;
    //         const decoded = raw && Buffer.isBuffer(raw)
    //             ? raw.toString()
    //             : JSON.stringify(raw);

    //         console.error(`Session ${sessionId}: Speech synthesis error with Gabber:`, decoded || err.message);
    //         throw err;
    //     }
    // }


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
    if (!session.availableChannel) {
        session.availableChannel = [];
    }
    if (!session.availableChannel.includes(channel)) {
        session.availableChannel.push(channel);
        let prompt = `${session.prompt}
        Available channels:
        ${session.availableChannel.join(",")}
        `
        session.prompt = prompt

    }
    // console.log(session.availableChannel)
}

const changePrompt = (session, prompt, tools, ws) => {
    if (!session.availableChannel) {
        session.availableChannel = [];
    }
    let changePrompt = `${prompt}
        Available channels:
        ${session.availableChannel.join(",")}
        `
    session.prompt = changePrompt;
    session.tools = tools

    ws.send(JSON.stringify({
        type: "current_prompt",
        streamSid: session.streamSid,
        prompt: session.prompt,
        functions: toolDefinitions
    }))
    // console.log(session.prompt, session.tools)
}

// Initialize WebSocket Server
const wss = new WebSocket.Server({ port: 5001 });
console.log("✅ WebSocket server started on ws://localhost:5001");

// Session Management Instance
const sessionManager = new SessionManager();

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
                sessionId = parsedData.streamSid;
                session = sessionManager.createSession(sessionId, ws); // Pass ws to session manager
                session.callSid = parsedData.start?.callSid;
                session.streamSid = parsedData?.streamSid; // Confirm streamSid in session
                session.caller = parsedData.start?.customParameters?.caller;
                // console.log(session.caller);
                console.log(`Session ${sessionId}: Twilio stream started for CallSid: ${session.callSid}`);
                ws.send(JSON.stringify({
                    type: "current_prompt",
                    streamSid: sessionId,
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

                // console.log("ffmpeg initiated")

                session.vadProcess = spawn(process.env.PYTHON_PATH || 'python3', ['vad.py']); // Use env var for Python path
                session.ffmpegProcess.stdout.pipe(session.vadProcess.stdin); // Pipe FFmpeg output to VAD input

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
        if (sessionId) {
            sessionManager.deleteSession(sessionId);
        }
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

































// LiveKit AI Agent Integration
// const { Room, RoomEvent } = require('@livekit/rtc-node');
const express = require('express');
const cors = require('cors');

// const { Room, RoomEvent, RemoteAudioTrack, TrackSource } = require('@livekit/rtc-node');
const { AccessToken } = require('livekit-server-sdk');

// Adjust path as needed

const aiRooms = new Map(); // Store AI room connections

// Function to create and manage AI room connection
async function createAIRoomConnection(roomName, apiKey, apiSecret) {
    try {
        const aiSessionId = `ai-${roomName}-${Date.now()}`;

        // Generate AI agent token
        const aiToken = new AccessToken(apiKey, apiSecret, {
            identity: `ai-agent-${aiSessionId}`,
            ttl: 60 * 60 * 24, // 24 hours
        });

        aiToken.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true
        });

        const aiTokenJwt = aiToken.toJwt();
        const aiRoom = new Room();

        // Add connection event handlers BEFORE connecting
        aiRoom.on(RoomEvent.Connected, () => {
            console.log(`🤖 AI agent connected to room: ${roomName}`);
        });

        aiRoom.on(RoomEvent.Disconnected, (reason) => {
            console.log(`🔌 AI agent disconnected from room: ${roomName}, reason:`, reason);
            
            // Stop audio recording when AI disconnects
            const roomData = aiRooms.get(roomName);
            if (roomData && roomData.egressId) {
                egressService.stopAudioRecording(roomData.egressId)
                    .then(() => console.log(`🛑 Stopped recording for room: ${roomName}`))
                    .catch(err => console.error(`❌ Error stopping recording:`, err));
            }
            
            aiRooms.delete(roomName);
        });

        aiRoom.on(RoomEvent.ParticipantConnected, (participant) => {
            console.log('👤 Participant joined:', participant.identity);

            // Subscribe to existing tracks
            participant.trackPublications.forEach((publication) => {
                if (publication.track) {
                    handleIncomingTrack(publication.track, publication, participant, roomName);
                }
            });
        });

        // Set up room event handlers
        setupRoomEventHandlers(aiRoom, roomName);

        // Connect to room
        const wsUrl = process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL;
        if (!wsUrl) {
            throw new Error('LIVEKIT_URL or LIVEKIT_WS_URL not configured');
        }

        await aiRoom.connect(wsUrl, aiTokenJwt);

        // Start audio recording via Egress
        let egressInfo = null;
        try {
            egressInfo = await egressService.startAudioRecording(roomName);
            console.log(`🎵 Audio recording started for room: ${roomName}`);
        } catch (egressError) {
            console.warn(`⚠️ Failed to start audio recording:`, egressError.message);
            console.log(`ℹ️ Continuing without audio recording for room: ${roomName}`);
        }

        // Store the room connection
        aiRooms.set(roomName, {
            room: aiRoom,
            sessionId: aiSessionId,
            egressId: egressInfo?.egressId,
            recordingId: egressInfo?.recordingId,
            filePath: egressInfo?.filePath,
            connectedAt: new Date()
        });

        return { aiRoom, aiSessionId, egressId: egressInfo?.egressId };

    } catch (error) {
        console.error('❌ Error creating AI room connection:', error);
        throw error;
    }
}

// Proper track handling function
function handleIncomingTrack(track, publication, participant, roomName) {
    // Validate parameters
    if (!track) {
        console.error('❌ No track provided to handleIncomingTrack');
        return;
    }
    
    if (!participant) {
        console.error('❌ No participant provided to handleIncomingTrack');
        return;
    }
    
    if (!roomName) {
        console.error('❌ No roomName provided to handleIncomingTrack');
        return;
    }

    // Properly handle track kind - it might be numeric enum
    let trackKind;
    if (typeof track.kind === 'number') {
        // Convert numeric enum to string
        trackKind = track.kind === 1 ? 'audio' : track.kind === 2 ? 'video' : 'unknown';
    } else {
        trackKind = track.kind;
    }

    console.log(`🎧 Handling ${trackKind} track from ${participant.identity} in room ${roomName}`);
    console.log(`📊 Track details:`, {
        kind: track.kind,
        kindString: trackKind,
        enabled: track.enabled,
        muted: track.muted,
        source: track.source,
        sid: track.sid,
        mediaStreamTrack: track.mediaStreamTrack
    });

    if (trackKind === 'audio' || track.kind === 1) {
        console.log('🎤 Audio track detected - Egress will handle audio capture and processing');
        
        // Since we're using Egress for audio capture, we don't need to process tracks directly
        // Egress will capture all audio and send it to our processing pipeline
        
    } else if (trackKind === 'video' || track.kind === 2) {
        console.log('📹 Processing video from:', participant.identity);
        // Handle video if needed
    } else {
        console.log('❓ Unknown track kind:', track.kind, trackKind);
    }
}

function processRemoteAudioTrack(track, participant, roomName) {
    console.log('🔊 Processing RemoteAudioTrack');
    console.log('🔍 Track properties:', Object.keys(track));
    console.log('🔍 Track prototype:', Object.getPrototypeOf(track));

    // For LiveKit Node.js FFI tracks, we need to use specific methods
    try {
        // Method 1: Try to get track info
        if (track.info) {
            console.log('✅ Found track info:', track.info);
        }

        // Method 2: Try to set up audio data listener using FFI methods
        if (track.ffi_handle) {
            console.log('✅ Found FFI handle, setting up audio listener');

            // Debug: Log all available methods on the track
            const trackMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(track));
            console.log('🔍 Available track methods:', trackMethods);

            // For LiveKit Node.js, we need to use the track's data events
            // The track should have methods to access audio data
            if (typeof track.onData === 'function') {
                console.log('🎵 Setting up onData listener for audio processing');
                track.onData((data) => {
                    console.log(`🎵 Received audio data from ${participant.identity}:`, data.length, 'bytes');
                    processRawAudioData(data, participant, roomName);
                });
            } else if (typeof track.onFrame === 'function') {
                console.log('🎵 Setting up onFrame listener for audio processing');
                track.onFrame((frame) => {
                    console.log(`🎵 Received audio frame from ${participant.identity}:`, frame.length, 'samples');
                    processAudioFrame(frame, participant, roomName);
                });
            } else if (typeof track.onAudioData === 'function') {
                console.log('🎵 Setting up onAudioData listener for audio processing');
                track.onAudioData((data) => {
                    console.log(`🎵 Received audio data from ${participant.identity}:`, data.length, 'bytes');
                    processRawAudioData(data, participant, roomName);
                });
            } else {
                // Try to access the underlying FFI methods
                console.log('🔍 Attempting to access FFI methods directly');

                // For LiveKit Node.js, we might need to use different approach
                // Let's try to get the track's data using the FFI handle
                if (typeof track.start === 'function') {
                    console.log('🎵 Starting track data collection');
                    track.start();
                }

                // Try to enable audio data collection
                if (typeof track.enableAudioData === 'function') {
                    console.log('🎵 Enabling audio data collection');
                    track.enableAudioData();
                }

                // Try to get the track's data stream
                if (typeof track.getDataStream === 'function') {
                    console.log('🎵 Getting track data stream');
                    const dataStream = track.getDataStream();
                    if (dataStream) {
                        dataStream.on('data', (data) => {
                            console.log(`🎵 Received audio data from stream:`, data.length, 'bytes');
                            processRawAudioData(data, participant, roomName);
                        });
                    }
                }

                // Set up a periodic check for audio data
                const audioCheckInterval = setInterval(() => {
                    try {
                        // Try to get audio data from the track
                        if (typeof track.getData === 'function') {
                            const data = track.getData();
                            if (data && data.length > 0) {
                                console.log(`🎵 Received audio data via getData:`, data.length, 'bytes');
                                processRawAudioData(data, participant, roomName);
                            }
                        }
                    } catch (error) {
                        console.log('❌ Error checking for audio data:', error.message);
                        clearInterval(audioCheckInterval);
                    }
                }, 100); // Check every 100ms

                // Clean up interval after 10 seconds if no data
                setTimeout(() => {
                    clearInterval(audioCheckInterval);
                    console.log('⏰ Audio check interval cleared');
                }, 10000);
            }
        } else {
            console.error('❌ No FFI handle found on track');
            console.log('🔍 Available track properties:', Object.keys(track));
        }

    } catch (error) {
        console.error('❌ Error setting up audio processing:', error);
    }
}

function processGenericAudioTrack(track, participant, roomName) {
    console.log('🔊 Processing generic audio track');
    console.log('🔍 Available track properties:', Object.keys(track));
    console.log('🔍 Track prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(track)));

    // Try different ways to access the audio data
    if (track.mediaStream) {
        console.log('📻 Using track.mediaStream');
        processAudioStream(track.mediaStream, participant, roomName);
    } else if (track.track) {
        console.log('📻 Using track.track');
        const mediaStream = new MediaStream([track.track]);
        processAudioStream(mediaStream, participant, roomName);
    } else if (typeof track.onData === 'function') {
        console.log('📻 Using track.onData for raw audio');
        track.onData((data) => {
            console.log('🎵 Received raw audio data:', data.length, 'bytes');
            processRawAudioData(data, participant, roomName);
        });
    } else if (typeof track.onFrame === 'function') {
        console.log('📻 Using track.onFrame for audio frames');
        track.onFrame((frame) => {
            console.log('🎵 Received audio frame:', frame.length, 'samples');
            processAudioFrame(frame, participant, roomName);
        });
    } else {
        console.error('❌ Cannot find audio data in track');
        console.log('🔍 Track type:', typeof track);
        console.log('🔍 Track constructor:', track.constructor.name);

        // Try to set up Node.js audio processing as fallback
        setupNodeAudioProcessing(track, participant, roomName);
    }
}

// Safer audio stream processing
function processAudioStream(mediaStream, participant, roomName) {
    console.log(`🎧 Processing audio stream from ${participant.identity} in room ${roomName}`);

    try {
        // Check if mediaStream is valid
        if (!mediaStream || !mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
            console.error('❌ Invalid or empty MediaStream');
            return;
        }

        const audioTracks = mediaStream.getAudioTracks();
        console.log(`🎵 Found ${audioTracks.length} audio tracks`);

        audioTracks.forEach((audioTrack, index) => {
            console.log(`🎤 Audio track ${index}:`, {
                id: audioTrack.id,
                kind: audioTrack.kind,
                enabled: audioTrack.enabled,
                readyState: audioTrack.readyState,
                muted: audioTrack.muted
            });
        });

        // Process the audio (replace with your actual processing logic)
        setupAudioProcessing(mediaStream, participant, roomName);

    } catch (error) {
        console.error('❌ Error in processAudioStream:', error);
        console.error('📄 Error stack:', error.stack);
    }
}

// Fixed room event handlers
function setupRoomEventHandlers(aiRoom, roomName) {
    aiRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(`🎵 Track subscribed from ${participant.identity}`);
        console.log(`📋 Publication details:`, {
            kind: publication.kind,
            source: publication.source,
            subscribed: publication.isSubscribed,
            enabled: publication.enabled
        });

        // Enable audio data collection for audio tracks
        if (track.kind === 1 || track.kind === 'audio') {
            console.log('🎵 Audio track subscribed - Egress will handle audio capture');
        }

        // Use the fixed handler
        handleIncomingTrack(track, publication, participant, roomName);
    });

    aiRoom.on(RoomEvent.TrackPublished, async (publication, participant) => {
        console.log(`📢 Track published: ${publication.kind} by ${participant.identity}`);

        // Auto-subscribe to audio tracks with error handling
        if ((publication.kind === 'audio' || publication.kind === 1) && !publication.isSubscribed) {
            try {
                console.log(`🔄 Auto-subscribing to audio from ${participant.identity}`);
                await publication.setSubscribed(true);
                console.log(`✅ Successfully subscribed to audio from ${participant.identity}`);
            } catch (subscribeError) {
                console.error(`❌ Failed to subscribe to audio from ${participant.identity}:`, subscribeError);
            }
        }
    });

    // Add more robust error handling
    aiRoom.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (quality === 'poor') {
            console.warn(`⚠️ Poor connection quality for ${participant?.identity || 'local'}`);
        }
    });

    aiRoom.on(RoomEvent.Reconnecting, () => {
        console.log('🔄 AI agent reconnecting due to connection issues...');
    });

    aiRoom.on(RoomEvent.Reconnected, () => {
        console.log('✅ AI agent reconnected successfully');
    });

    aiRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('👤 Participant disconnected:', participant.identity);
        
        // Clean up audio buffer for this participant
        if (audioBuffers.has(participant.identity)) {
            audioBuffers.delete(participant.identity);
            console.log(`🧹 Cleaned up audio buffer for ${participant.identity}`);
        }
    });
}

// Audio processing setup (implement based on your needs)
function setupAudioProcessing(mediaStream, participant, roomName) {
    console.log(`🎧 Setting up audio processing for ${participant.identity}`);

    // Example: Create audio processing pipeline
    // Replace this with your actual audio processing logic

    try {
        // For server-side Node.js, you might need to use different libraries
        // like node-web-audio-api or send audio to external services

        console.log('🔧 Audio processing pipeline initialized');

        // Example: Send to speech recognition service
        // sendToSpeechRecognition(mediaStream, participant, roomName);

    } catch (error) {
        console.error('❌ Error setting up audio processing:', error);
    }
}
// Alternative audio processing for Node.js environment
function processAudioInChunks(mediaStream, participant, roomName) {
    // This is a simplified approach - you might need to use a different method
    // depending on how your RemoteAudioTrack provides audio data

    console.log(`🎵 Processing audio chunks for ${participant.identity}`);

    // You might need to implement this based on your specific LiveKit SDK version
    // Some versions provide different methods to access audio data

    // Placeholder for actual audio chunk processing
    // This would depend on your specific LiveKit SDK implementation
}

// Process audio with AI and generate response
async function processAudioWithAI(audioBuffer, participant, roomName) {
    try {
        console.log(`🤖 Processing audio with AI for ${participant.identity}`);

        if (!aiProcessing) {
            console.error('❌ AI processing module not available');
            return;
        }

        // 1. Convert audio to text (Speech-to-Text)
        const transcription = await aiProcessing.transcribeAudio(audioBuffer);
        console.log(`📝 Transcription: "${transcription}"`);

        if (!transcription || transcription.trim().length === 0) {
            console.log('⚠️ No speech detected in audio');
            return;
        }

        // 2. Process with AI to generate response
        const aiResponse = await aiProcessing.generateResponse(transcription, {
            participant: participant.identity,
            room: roomName,
            context: 'Gautam Garment assistant'
        });

        console.log(`💭 AI Response: "${aiResponse}"`);

        // 3. Convert response to speech (Text-to-Speech)
        const responseAudio = await aiProcessing.synthesizeSpeech(aiResponse);

        if (responseAudio) {
            // 4. Publish AI response audio to the room
            const success = await publishAudioToRoom(roomName, responseAudio);

            if (success) {
                console.log(`✅ AI response published to room: ${roomName}`);
            } else {
                console.error(`❌ Failed to publish AI response to room: ${roomName}`);
            }
        }

    } catch (error) {
        console.error('❌ Error processing audio with AI:', error);
    }
}

// Fixed audio publishing function
async function publishAudioToRoom(roomName, mp3Buffer) {
    const roomData = aiRooms.get(roomName);
    if (!roomData?.room?.isConnected) {
        console.log(`❌ Room ${roomName} not connected`);
        return false;
    }

    const { room } = roomData;

    try {
        // Convert MP3 to PCM
        const pcm = await mp3ToPcmInt16(mp3Buffer);
        console.log(`🎵 PCM data length: ${pcm.length} samples`);

        // Create audio source and track
        const source = new AudioSource(16000, 1);
        const track = LocalAudioTrack.createAudioTrack('ai-response', source);

        // Publish the track first
        await room.localParticipant.publishTrack(track, {
            source: TrackSource.SOURCE_MICROPHONE,
            name: 'ai-response'
        });
        console.log(`🎵 Track published to room: ${roomName}`);

        // Stream audio in chunks
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

        console.log(`✅ Audio streaming completed for room: ${roomName}`);

        // Calculate duration and unpublish after delay
        const totalDurationMs = (pcm.length / 16000) * 1000;
        const safetyMargin = 1000;

        setTimeout(() => {
            try {
                room.localParticipant.unpublishTrack(track);
                console.log(`🔇 Track unpublished from room: ${roomName}`);
            } catch (error) {
                console.error('❌ Error unpublishing track:', error);
            }
        }, totalDurationMs + safetyMargin);

        return true;

    } catch (error) {
        console.error(`❌ Error publishing audio to room ${roomName}:`, error);
        return false;
    }
}

// Streaming version of audio publishing
async function publishAudioToRoomStreaming(roomName, mp3Buffer) {
    const roomData = aiRooms.get(roomName);
    if (!roomData?.room?.isConnected) {
        console.log(`❌ Room ${roomName} not connected for streaming`);
        return false;
    }

    const { room } = roomData;

    try {
        const pcm = await mp3ToPcmInt16(mp3Buffer);
        console.log(`🎵 Starting streaming for ${pcm.length} samples`);

        // Create audio source
        const source = new AudioSource(16000, 1);
        const track = LocalAudioTrack.createAudioTrack('ai-response-stream', source);

        // Publish track
        await room.localParticipant.publishTrack(track, {
            source: TrackSource.SOURCE_MICROPHONE,
            name: 'ai-response-stream'
        });

        // Stream in real-time
        const SAMPLES_PER_FRAME = 480; // 30ms frames
        let offset = 0;

        const streamInterval = setInterval(async () => {
            if (offset >= pcm.length) {
                clearInterval(streamInterval);

                // Unpublish after delay
                setTimeout(() => {
                    try {
                        room.localParticipant.unpublishTrack(track);
                        console.log(`🔇 Streaming completed and track unpublished`);
                    } catch (error) {
                        console.error('❌ Error unpublishing streaming track:', error);
                    }
                }, 500);
                return;
            }

            const chunk = pcm.slice(offset, offset + SAMPLES_PER_FRAME);
            if (chunk.length > 0) {
                const audioFrame = new AudioFrame(chunk, 16000, 1, chunk.length);

                try {
                    await source.captureFrame(audioFrame);
                    offset += SAMPLES_PER_FRAME;
                } catch (error) {
                    console.error('❌ Error capturing frame:', error);
                    clearInterval(streamInterval);
                }
            }
        }, 30); // 30ms intervals

        return true;

    } catch (error) {
        console.error('❌ Error in streaming audio:', error);
        return false;
    }
}

// Enhanced MP3 to PCM conversion
async function mp3ToPcmInt16(mp3Buf) {
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
}

// Express server setup
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'audio/*', limit: '50mb' })); // For audio streams from Egress
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

// Audio stream endpoint for Egress
app.post('/audio-stream/:roomName', (req, res) => {
    const { roomName } = req.params;
    const audioData = req.body;
    
    console.log(`🎵 Received audio stream for room ${roomName}:`, audioData.length, 'bytes');
    
    // Process audio with AI in real-time
    const roomData = aiRooms.get(roomName);
    if (roomData) {
        // Create a mock participant for AI processing
        const mockParticipant = {
            identity: 'user-audio-stream',
            room: roomName
        };
        
        processAudioWithAI(audioData, mockParticipant, roomName)
            .then(() => console.log(`✅ Processed audio stream for room: ${roomName}`))
            .catch(err => console.error(`❌ Error processing audio stream:`, err));
    }
    
    res.status(200).send('OK');
});

// Start recording endpoint
app.post('/api/start-recording/:roomName', async (req, res) => {
    try {
        const { roomName } = req.params;
        const egressInfo = await egressService.startAudioRecording(roomName);
        res.json({ success: true, egressId: egressInfo.egressId });
    } catch (error) {
        console.error('❌ Error starting recording:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop recording endpoint
app.post('/api/stop-recording/:egressId', async (req, res) => {
    try {
        const { egressId } = req.params;
        await egressService.stopAudioRecording(egressId);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error stopping recording:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get recording status endpoint
app.get('/api/recording-status/:egressId', async (req, res) => {
    try {
        const { egressId } = req.params;
        const status = await egressService.getRecordingStatus(egressId);
        res.json(status);
    } catch (error) {
        console.error('❌ Error getting recording status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process audio file endpoint
app.post('/api/process-audio/:roomName', async (req, res) => {
    try {
        const { roomName } = req.params;
        const roomData = aiRooms.get(roomName);
        
        if (!roomData || !roomData.filePath) {
            return res.status(404).json({ error: 'No recording found for room' });
        }
        
        const mockParticipant = {
            identity: 'user-audio-file',
            room: roomName
        };
        
        await egressService.processAudioFile(roomData.filePath, mockParticipant, roomName);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error processing audio file:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        activeRooms: aiRooms.size,
        timestamp: new Date().toISOString()
    });
});

// LiveKit token generation endpoint
app.post('/api/livekit-token', async (req, res) => {
    try {
        console.log("🚀 LiveKit token request received");
        const { room, identity } = req.body;

        if (!room || !identity) {
            return res.status(400).json({ error: 'Room and identity are required' });
        }

        const { AccessToken } = require('livekit-server-sdk');
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;

        if (!apiKey || !apiSecret) {
            return res.status(500).json({ error: 'LiveKit API credentials not configured' });
        }

        // Create or get AI room connection
        let aiSessionId;
        let egressId;
        if (!aiRooms.has(room)) {
            console.log(`🤖 Creating new AI connection for room: ${room}`);
            try {
                const { aiSessionId: newSessionId, egressId: newEgressId } = await createAIRoomConnection(room, apiKey, apiSecret);
                aiSessionId = newSessionId;
                egressId = newEgressId;
            } catch (error) {
                console.error('❌ Failed to create AI room connection:', error);
                return res.status(500).json({ error: 'Failed to create AI room connection' });
            }
        } else {
            console.log(`🤖 AI agent already connected to room: ${room}`);
            const roomData = aiRooms.get(room);
            aiSessionId = roomData.sessionId;
            egressId = roomData.egressId;
        }

        // Generate user token
        const userToken = new AccessToken(apiKey, apiSecret, {
            identity: identity,
            ttl: 60 * 60, // 1 hour
        });

        userToken.addGrant({
            roomJoin: true,
            room: room,
            canPublish: true,
            canSubscribe: true
        });

        const token = userToken.toJwt();
        console.log(`🔑 User token generated for: ${identity}`);

        // Send greeting after user joins
        setTimeout(async () => {
            try {
                const greetingText = "Hello! I'm your AI assistant for Gautam Garment. How can I help you today?";

                if (aiProcessing && typeof aiProcessing.synthesizeSpeech === 'function') {
                    const mp3Buffer = await aiProcessing.synthesizeSpeech(greetingText, aiSessionId);

                    if (mp3Buffer) {
                        console.log(`🎵 AI greeting audio generated for session: ${aiSessionId}`);

                        const success = await publishAudioToRoomStreaming(room, mp3Buffer);

                        if (success) {
                            console.log(`✅ AI greeting audio published to room: ${room}`);
                        } else {
                            console.log(`❌ Failed to publish AI greeting audio to room: ${room}`);
                        }
                    }
                } else {
                    console.log('⚠️ AI processing not available, skipping greeting');
                }
            } catch (error) {
                console.error(`❌ Error generating/publishing AI greeting:`, error);
            }
        }, 2000);

        res.json({
            token,
            room: room,
            aiSessionId: aiSessionId,
            egressId: egressId,
            message: 'Room created and AI agent session established with audio recording',
            wsUrl: process.env.LIVEKIT_URL || process.env.LIVEKIT_WS_URL
        });

    } catch (error) {
        console.error('❌ Error generating LiveKit token:', error);
        res.status(500).json({ error: 'Failed to generate token', details: error.message });
    }
});

// Cleanup endpoint
app.post('/api/cleanup-room', async (req, res) => {
    try {
        const { room } = req.body;

        if (aiRooms.has(room)) {
            const roomData = aiRooms.get(room);
            
            // Stop Egress recording if active
            if (roomData.egressId) {
                try {
                    await egressService.stopAudioRecording(roomData.egressId);
                    console.log(`🛑 Stopped Egress recording for room: ${room}`);
                } catch (egressError) {
                    console.error(`❌ Error stopping Egress recording:`, egressError);
                }
            }
            
            // Disconnect from LiveKit room
            if (roomData.room && roomData.room.isConnected) {
                await roomData.room.disconnect();
            }
            
            aiRooms.delete(room);
            console.log(`🧹 Room ${room} cleaned up`);
        }

        res.json({ message: 'Room cleaned up successfully' });
    } catch (error) {
        console.error('❌ Error cleaning up room:', error);
        res.status(500).json({ error: 'Failed to cleanup room' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');

    // Disconnect all AI rooms and stop recordings
    for (const [roomName, roomData] of aiRooms.entries()) {
        try {
            // Stop Egress recording
            if (roomData.egressId) {
                await egressService.stopAudioRecording(roomData.egressId);
                console.log(`🛑 Stopped Egress recording for room: ${roomName}`);
            }
            
            // Disconnect from LiveKit room
            if (roomData.room && roomData.room.isConnected) {
                await roomData.room.disconnect();
                console.log(`🔌 Disconnected AI from room: ${roomName}`);
            }
        } catch (error) {
            console.error(`❌ Error disconnecting from room ${roomName}:`, error);
        }
    }

    process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`);
    console.log('🤖 AI agent ready - LiveKit integration available');
    console.log('🎵 LiveKit Egress integration enabled for audio capture');
    console.log('📡 Required environment variables:');
    console.log('   - LIVEKIT_API_KEY');
    console.log('   - LIVEKIT_API_SECRET');
    console.log('   - LIVEKIT_URL or LIVEKIT_WS_URL');
    console.log('   - EGRESS_URL (optional, defaults to http://localhost:7880)');
    console.log('📁 Audio recordings will be saved to:', EGRESS_CONFIG.recordingsDir);
});

module.exports = {
    createAIRoomConnection,
    handleIncomingTrack,
    processAudioWithAI,
    publishAudioToRoom,
    publishAudioToRoomStreaming
};

// Node.js specific audio processing
function setupNodeAudioProcessing(track, participant, roomName) {
    console.log(`🎧 Setting up Node.js audio processing for ${participant.identity}`);

    // For LiveKit in Node.js, we need to use the track's data events
    if (typeof track.onData === 'function') {
        console.log('🎵 Setting up onData listener for audio processing');
        track.onData((data) => {
            console.log(`🎵 Received audio data from ${participant.identity}:`, data.length, 'bytes');
            processRawAudioData(data, participant, roomName);
        });
    } else if (typeof track.onFrame === 'function') {
        console.log('🎵 Setting up onFrame listener for audio processing');
        track.onFrame((frame) => {
            console.log(`🎵 Received audio frame from ${participant.identity}:`, frame.length, 'samples');
            processAudioFrame(frame, participant, roomName);
        });
    } else {
        console.log('❌ No audio data access method available on track');
        console.log('🔍 Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(track)));
    }
}

// Audio buffer management for each participant
const audioBuffers = new Map(); // participant -> buffer

function getOrCreateAudioBuffer(participantId) {
    if (!audioBuffers.has(participantId)) {
        audioBuffers.set(participantId, {
            buffer: Buffer.alloc(0),
            lastActivity: Date.now(),
            isProcessing: false
        });
    }
    return audioBuffers.get(participantId);
}

function processRawAudioData(data, participant, roomName) {
    console.log(`🎧 Processing raw audio data from ${participant.identity}`);

    // Get or create audio buffer for this participant
    const audioBuffer = getOrCreateAudioBuffer(participant.identity);

    // Convert data to appropriate format for processing
    // This depends on the data format provided by LiveKit
    try {
        // For now, just log the data - you can implement actual processing here
        console.log(`📊 Audio data format:`, {
            type: typeof data,
            isBuffer: Buffer.isBuffer(data),
            length: data.length,
            sampleRate: 'unknown' // You might need to get this from track properties
        });

        // Add data to buffer
        if (Buffer.isBuffer(data)) {
            audioBuffer.buffer = Buffer.concat([audioBuffer.buffer, data]);
            audioBuffer.lastActivity = Date.now();

            console.log(`🎵 Audio buffer for ${participant.identity}: ${audioBuffer.buffer.length} bytes total`);

            // Process buffer if it's large enough (e.g., 1 second of audio)
            // This is a simplified approach - you might want more sophisticated buffering
            if (audioBuffer.buffer.length > 32000 && !audioBuffer.isProcessing) { // ~1 second at 16kHz
                audioBuffer.isProcessing = true;
                console.log(`🎵 Processing audio buffer for ${participant.identity}`);

                // Process the buffered audio
                processAudioWithAI(audioBuffer.buffer, participant, roomName);

                // Clear buffer after processing
                audioBuffer.buffer = Buffer.alloc(0);
                audioBuffer.isProcessing = false;
            }
        }

    } catch (error) {
        console.error('❌ Error processing raw audio data:', error);
    }
}

function processAudioFrame(frame, participant, roomName) {
    console.log(`🎧 Processing audio frame from ${participant.identity}`);

    try {
        console.log(`📊 Audio frame details:`, {
            type: typeof frame,
            length: frame.length,
            sampleRate: frame.sampleRate || 'unknown',
            numberOfChannels: frame.numberOfChannels || 'unknown'
        });

        // Convert frame to appropriate format for processing
        // This depends on the frame format provided by LiveKit

        // Example: Send to AI processing (commented out for now)
        // processAudioWithAI(frame, participant, roomName);

    } catch (error) {
        console.error('❌ Error processing audio frame:', error);
    }
}

// LiveKit Egress Service Functions
const egressService = {
    // Start audio recording for a room
    async startAudioRecording(roomName) {
        try {
            console.log(`🎵 Starting audio recording for room: ${roomName}`);
            
            const recordingId = `audio-${roomName}-${Date.now()}`;
            const filePath = path.join(EGRESS_CONFIG.tempDir, `${recordingId}.mp3`);
            
            const egressRequest = {
                room_name: roomName,
                output_type: 'mp3',
                audio_only: true,
                file_output: {
                    filepath: filePath
                },
                // Also stream to our server for real-time processing
                stream_output: {
                    urls: [`http://localhost:3001/audio-stream/${roomName}`]
                }
            };

            const response = await fetch(`${EGRESS_CONFIG.baseUrl}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${EGRESS_CONFIG.apiKey}:${EGRESS_CONFIG.apiSecret}`
                },
                body: JSON.stringify(egressRequest)
            });

            if (!response.ok) {
                throw new Error(`Egress start failed: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`✅ Audio recording started: ${result.egress_id}`);
            
            return {
                egressId: result.egress_id,
                filePath: filePath,
                recordingId: recordingId
            };
        } catch (error) {
            console.error('❌ Error starting audio recording:', error);
            throw error;
        }
    },

    // Stop audio recording
    async stopAudioRecording(egressId) {
        try {
            console.log(`🛑 Stopping audio recording: ${egressId}`);
            
            const response = await fetch(`${EGRESS_CONFIG.baseUrl}/stop/${egressId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${EGRESS_CONFIG.apiKey}:${EGRESS_CONFIG.apiSecret}`
                }
            });

            if (!response.ok) {
                throw new Error(`Egress stop failed: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`✅ Audio recording stopped: ${egressId}`);
            
            return result;
        } catch (error) {
            console.error('❌ Error stopping audio recording:', error);
            throw error;
        }
    },

    // Get recording status
    async getRecordingStatus(egressId) {
        try {
            const response = await fetch(`${EGRESS_CONFIG.baseUrl}/status/${egressId}`, {
                headers: {
                    'Authorization': `Bearer ${EGRESS_CONFIG.apiKey}:${EGRESS_CONFIG.apiSecret}`
                }
            });

            if (!response.ok) {
                throw new Error(`Egress status failed: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('❌ Error getting recording status:', error);
            throw error;
        }
    },

    // Process audio file with AI
    async processAudioFile(filePath, participant, roomName) {
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`⚠️ Audio file not found: ${filePath}`);
                return;
            }

            const audioBuffer = fs.readFileSync(filePath);
            console.log(`🎵 Processing audio file: ${filePath} (${audioBuffer.length} bytes)`);
            
            // Process with AI
            await processAudioWithAI(audioBuffer, participant, roomName);
            
            // Move to recordings directory
            const finalPath = path.join(EGRESS_CONFIG.recordingsDir, path.basename(filePath));
            fs.renameSync(filePath, finalPath);
            console.log(`📁 Moved recording to: ${finalPath}`);
            
        } catch (error) {
            console.error('❌ Error processing audio file:', error);
        }
    }
};