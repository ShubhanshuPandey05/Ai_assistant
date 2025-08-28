// Core Dependencies
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const OpenAI = require("openai");
const twilio = require('twilio');
const { twiml } = require('twilio');
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2025-07/graphql.json`;
// gRPC client now imported from modules/turnDetector
const { Transform } = require('stream');
const WebSocket = require('ws');
const { createClient, LiveTTSEvents, LiveClient } = require('@deepgram/sdk');
const deepgramTts = createClient(process.env.DEEPGRAM_API);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const bodyParser = require('body-parser');
// const { MessagingResponse } = require('twilio');
const shopifyService = require('./services/shopify');
const audioUtilsModule = require('./utils/audio');
const aiService = require('./services/ai');

// LiveKit imports
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room, RoomEvent, RemoteParticipant, LocalParticipant, AudioPresets, VideoPresets, TrackSource, AudioSource, LocalAudioTrack, AudioFrame, TrackKind, AudioStream } = require('@livekit/rtc-node');
const NC = require('@livekit/noise-cancellation-node');

const { client: turnDetector } = require('./modules/turnDetector');

const FRAME_SMP = 480;
const FRAME_BYTES = FRAME_SMP * 2;

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const toolDefinitions = [
    {
        name: "getAllProducts",
        description: "Get all available products from the catalog",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "getUserDetailsByPhoneNo",
        description: "Get user details by phone number",
        parameters: {
            type: "object",
            properties: {
                phoneNo: {
                    type: "string",
                    description: "User's phone number"
                }
            },
            required: ["phoneNo"]
        }
    },
    {
        name: "getAllOrders",
        description: "Get all orders of that customer from the system",
        parameters: {
            type: "object",
            properties: {
                phoneNo: {
                    type: "string",
                    description: "User's phone number"
                }
            },
            required: ["phoneNo"]
        }
    },
    {
        name: "getOrderById",
        description: "Get order details by order ID",
        parameters: {
            type: "object",
            properties: {
                orderId: {
                    type: "string",
                    description: "The unique order identifier"
                }
            },
            required: ["orderId"]
        }
    },
    {
        name: "hangUp",
        description: "Hang up the call",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        "name": "cancelOrder",
        "description": "Cancel a Shopify order with specified options. This function can cancel an order, issue refunds, restock items, and send notification emails to customers.",
        "parameters": {
            "type": "object",
            "properties": {
                "orderId": {
                    "type": "string",
                    "description": "The Shopify order ID to cancel. Can be either a numeric ID or full GraphQL ID."
                },
                "reason": {
                    "type": "string",
                    "description": "The reason for cancelling the order",
                    "enum": ["CUSTOMER", "FRAUD", "INVENTORY", "DECLINED", "OTHER"],
                    "default": "OTHER"
                },
                "email": {
                    "type": "boolean",
                    "description": "Whether to send a cancellation email to the customer",
                    "default": true
                },
                "refund": {
                    "type": "boolean",
                    "description": "Whether to issue a refund for the cancelled order",
                    "default": true
                },
                "restock": {
                    "type": "boolean",
                    "description": "Whether to restock the cancelled items back to inventory",
                    "default": true
                }
            },
            "required": ["orderId"]
        }
    },
    {
        "name": "checkOrderCancellable",
        "description": "Check if a Shopify order can be cancelled. This function verifies the order status and returns whether cancellation is possible along with the reason if it's not cancellable.",
        "parameters": {
            "type": "object",
            "properties": {
                "orderId": {
                    "type": "string",
                    "description": "The Shopify order ID to check. Can be either a numeric ID or full GraphQL ID."
                }
            },
            "required": ["orderId"]
        }
    }

];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_AI);

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
    openai: new OpenAI({ apiKey: process.env.OPEN_AI }),
    gemini: genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",  // or "gemini-2.0-flash-thinking-exp"
        // Optional: Add safety settings
        safetySettings: [
            {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
        ]
    })
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

        try {
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
        } catch (error) {
            console.log(error)
            return "Currently i am having the issue in the fetching the product due to sphoify url issue."
        }
    },

    async getUserDetailsByPhoneNo(phone) {

        console.log("phone:-", phone)
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

    //     async getAllOrders(cursor = null) {
    //         const query = `
    //     {
    //       orders(first: 50${cursor ? `, after: "${cursor}"` : ''}) {
    //         edges {
    //           cursor
    //           node {
    //             id
    //             name
    //             email
    //             phone
    //             totalPriceSet {
    //               shopMoney {
    //                 amount
    //                 currencyCode
    //               }
    //             }
    //             createdAt
    //             fulfillmentStatus
    //             lineItems(first: 10) {
    //               edges {
    //                 node {
    //                   title
    //                   quantity
    //                 }
    //               }
    //             }
    //           }
    //         }
    //         pageInfo {
    //           hasNextPage
    //         }
    //       }
    //     }
    //   `;

    //         const response = await fetch(graphqlEndpoint, {
    //             method: 'POST',
    //             headers: {
    //                 'Content-Type': 'application/json',
    //                 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    //             },
    //             body: JSON.stringify({ query }),
    //         });

    //         const data = await response.json();
    //         if (!data.data || !data.data.orders) return { orders: [], hasNextPage: false, lastCursor: null };

    //         const orders = data.data.orders.edges.map(edge => ({
    //             id: edge.node.id,
    //             name: edge.node.name,
    //             email: edge.node.email,
    //             phone: edge.node.phone,
    //             total: edge.node.totalPriceSet.shopMoney.amount,
    //             currency: edge.node.totalPriceSet.shopMoney.currencyCode,
    //             createdAt: edge.node.createdAt,
    //             fulfillmentStatus: edge.node.fulfillmentStatus,
    //             lineItems: edge.node.lineItems.edges.map(itemEdge => ({
    //                 title: itemEdge.node.title,
    //                 quantity: itemEdge.node.quantity
    //             }))
    //         }));

    //         const hasNextPage = data.data.orders.pageInfo.hasNextPage;
    //         const lastCursor = data.data.orders.edges.length > 0 ? data.data.orders.edges[data.data.orders.edges.length - 1].cursor : null;

    //         return { orders, hasNextPage, lastCursor };
    //     },

    async getAllOrders(phone, cursor = null) {
        try {
            let customer = await this.getUserDetailsByPhoneNo(phone);
            if (!customer || !customer.id) {
                throw new Error("Customer not found");
            }

            let customerId = customer.id.split('/').pop(); // gives "1234567890"
            console.log("customerId:", customerId);

            const query = `
            {
              orders(first: 50${cursor ? `, after: "${cursor}"` : ''}, query: "customer_id:${customerId} AND status:open") {
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
                    fulfillments {
                      status
                    }
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
            console.log("GraphQL response:", data);

            if (!data.data || !data.data.orders) {
                return { orders: [], hasNextPage: false, lastCursor: null };
            }

            const orders = data.data.orders.edges.map(edge => ({
                id: edge.node.id,
                name: edge.node.name,
                email: edge.node.email,
                phone: edge.node.phone,
                total: edge.node.totalPriceSet.shopMoney.amount,
                currency: edge.node.totalPriceSet.shopMoney.currencyCode,
                createdAt: edge.node.createdAt,
                fulfillmentStatus: edge.node.fulfillments.map(f => f.status).join(', '),
                lineItems: edge.node.lineItems.edges.map(itemEdge => ({
                    title: itemEdge.node.title,
                    quantity: itemEdge.node.quantity
                }))
            }));

            const hasNextPage = data.data.orders.pageInfo.hasNextPage;
            const lastCursor = data.data.orders.edges.length > 0
                ? data.data.orders.edges[data.data.orders.edges.length - 1].cursor
                : null;

            return { orders, hasNextPage, lastCursor };
        } catch (error) {
            console.error("Error in getAllOrders:", error);
            return { orders: [], hasNextPage: false, lastCursor: null };
        }
    },

    async getOrderById(orderId) {
        try {
            if (!orderId.startsWith("gid://")) {
                orderId = `gid://shopify/Order/${orderId}`;
            }

            const query = `
            query GetOrder($id: ID!) {
              order(id: $id) {
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
                fulfillments {
                  status
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      quantity
                    }
                  }
                }
              }
            }`;

            const variables = {
                id: orderId
            };

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(graphqlEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                },
                body: JSON.stringify({
                    query,
                    variables
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(data)
            // Check for GraphQL errors
            if (data.errors) {
                console.error("GraphQL errors:", data.errors);
                return null;
            }

            if (!data.data || !data.data.order) {
                return null;
            }

            const order = data.data.order;
            return {
                id: order.id,
                name: order.name,
                email: order.email,
                phone: order.phone,
                total: order.totalPriceSet?.shopMoney?.amount || '0',
                currency: order.totalPriceSet?.shopMoney?.currencyCode || 'USD',
                createdAt: order.createdAt,
                fulfillmentStatus: order.fulfillments?.length > 0
                    ? order.fulfillments.map(f => f.status).join(', ')
                    : 'unfulfilled',
                lineItems: order.lineItems?.edges?.map(itemEdge => ({
                    title: itemEdge.node.title,
                    quantity: itemEdge.node.quantity
                })) || []
            };
        } catch (err) {
            if (err.name === 'AbortError') {
                console.error("Request timeout:", err);
            } else {
                console.error("getOrderById error:", err);
            }
            return null;
        }
    },

    async endCall(connection) {
        if (connection instanceof WebSocket) {
            connection.close();
            console.log("websocket connection close")
        } else {
            await roomService.deleteRoom(connection);
            return `Room ${connection} deleted`;
        }
    },

    async cancelOrder(orderId, options = {}) {
        try {
            if (!orderId.startsWith("gid://")) {
                orderId = `gid://shopify/Order/${orderId}`;
            }

            fetch(graphqlEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, // Replace with your actual access token
                },
                body: JSON.stringify({
                    query: `
                    mutation OrderCancel(
                      $orderId: ID!,
                      $notifyCustomer: Boolean,
                      $refundMethod: OrderCancelRefundMethodInput!,
                      $restock: Boolean!,
                      $reason: OrderCancelReason!,
                      $staffNote: String
                    ) {
                      orderCancel(
                        orderId: $orderId,
                        notifyCustomer: $notifyCustomer,
                        refundMethod: $refundMethod,
                        restock: $restock,
                        reason: $reason,
                        staffNote: $staffNote
                      ) {
                        job {
                          id
                          done
                        }
                        orderCancelUserErrors {
                          field
                          message
                          code
                        }
                        userErrors {
                          field
                          message
                        }
                      }
                    }
                  `,
                    variables: {
                        orderId: orderId, // Replace with actual order ID
                        notifyCustomer: true,
                        refundMethod: {
                            originalPaymentMethodsRefund: true
                        },
                        restock: true,
                        reason: "CUSTOMER",
                        staffNote: "Wrong size. Customer reached out saying they already re-purchased the correct size."
                    }
                })
            })
                .then(response => response.json())
                .then(data => console.log(data))
                .catch(error => console.error('Error:', error));


        } catch (err) {
            if (err.name === 'AbortError') {
                console.error("Request timeout:", err);
                return {
                    success: false,
                    error: "Request timeout"
                };
            } else {
                console.error("cancelOrder error:", err);
                return {
                    success: false,
                    error: err.message || "Unknown error occurred"
                };
            }
        }
    },

    // async checkOrderCancellable(orderId) {
    //     try {
    //         if (!orderId.startsWith("gid://")) {
    //             orderId = `gid://shopify/Order/${orderId}`;
    //         }

    //         const query = `
    //         query CheckOrderCancellable($id: ID!) {
    //           order(id: $id) {
    //             id
    //             name
    //             cancelledAt
    //             financialStatus
    //             fulfillmentStatus
    //             fulfillments {
    //               status
    //             }
    //           }
    //         }`;

    //         const variables = { id: orderId };

    //         const response = await fetch(graphqlEndpoint, {
    //             method: 'POST',
    //             headers: {
    //                 'Content-Type': 'application/json',
    //                 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    //             },
    //             body: JSON.stringify({ query, variables })
    //         });

    //         const data = await response.json();

    //         if (!data.data?.order) {
    //             return { cancellable: false, reason: "Order not found" };
    //         }

    //         const order = data.data.order;

    //         // Already cancelled
    //         if (order.cancelledAt) {
    //             return { cancellable: false, reason: "Order already cancelled" };
    //         }

    //         // Check if already fulfilled
    //         const hasCompleteFulfillments = order.fulfillments?.some(f => f.status === 'SUCCESS');
    //         if (hasCompleteFulfillments) {
    //             return {
    //                 cancellable: false,
    //                 reason: "Order has completed fulfillments - consider refunding instead"
    //             };
    //         }

    //         return {
    //             cancellable: true,
    //             order: {
    //                 id: order.id,
    //                 name: order.name,
    //                 financialStatus: order.financialStatus,
    //                 fulfillmentStatus: order.fulfillmentStatus
    //             }
    //         };

    //     } catch (err) {
    //         console.error("checkOrderCancellable error:", err);
    //         return { cancellable: false, reason: "Error checking order status" };
    //     }
    // }
}

// Wire external service implementations without changing names
try {
    if (shopifyService && typeof functions === 'object') {
        functions.getAllProducts = shopifyService.getAllProducts || functions.getAllProducts;
        functions.getUserDetailsByPhoneNo = shopifyService.getUserDetailsByPhoneNo || functions.getUserDetailsByPhoneNo;
        functions.getAllOrders = shopifyService.getAllOrders || functions.getAllOrders;
        functions.getOrderById = shopifyService.getOrderById || functions.getOrderById;
        functions.cancelOrder = shopifyService.cancelOrder || functions.cancelOrder;
    }
} catch (e) {
    // keep original inline implementations on error
}

// Configuration Constants
const CONFIG = {
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 1000,
    AUDIO_CHUNK_SIZE: 1600,
    DEEPGRAM_STREAM_CHUNK_SIZE: 400,
    SAMPLE_RATE: 16000,
    AUDIO_SAMPLE_RATE: 8000,
    POLLY_VOICE_ID: "Joanna",
    POLLY_OUTPUT_FORMAT: "mp3",
    GPT_MODEL: "gpt-4o-mini",
    GPT_MAX_TOKENS: 250,
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
const { SessionManager } = require('./modules/session');

// Audio Processing Utilities
const audioUtils = {
    generateSilenceBuffer: (durationMs, sampleRate = CONFIG.AUDIO_SAMPLE_RATE) => {
        const numSamples = Math.floor((durationMs / 1000) * sampleRate);
        return Buffer.alloc(numSamples);
    },

    convertMp3ToMulaw: audioUtilsModule.convertMp3ToMulaw,

    convertMp3ToPcmInt16: audioUtilsModule.convertMp3ToPcmInt16,

    streamMulawAudioToLiveKit: function (room, mulawBuffer, session) {
        const pcm = mulawBuffer;
        const CHUNK_SIZE_MULAW = 800;
        let offset = 0;
        session.isAIResponding = false;
        session.interruption = true;
        handleInterruption(session);
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

    streamMulawAudioToTwilio: audioUtilsModule.streamMulawAudioToTwilio,

    universalStreamAudio: audioUtilsModule.universalStreamAudio
};

// AI Processing
const aiProcessing = {

    // async processInputVIARESPONSE_API(input, session) {
    //     // console.log("here are the sessions details :", session.prompt, session.tools)

    //     const createResponseParams = {
    //         model: "gpt-4o-mini",
    //         input: input.message,
    //         instructions: session.prompt,
    //         tools: session.tools,
    //         // stream: true,
    //         // tools: toolDefinitions
    //     };
    //     if (session.lastResponseId) {
    //         createResponseParams.previous_response_id = session.lastResponseId;
    //     }
    //     let processTimeStart = Date.now()
    //     let response = await services.openai.responses.create(createResponseParams);
    //     let processTime = Date.now() - processTimeStart
    //     console.log("LLmProcessTime", processTime)
    //     session.lastResponseId = response.id;

    //     if (response.output[0].type === "function_call") {
    //         const tool = []
    //         let toolResult;

    //         if (response.output[0].name === "getAllProducts") {
    //             toolResult = await functions.getAllProducts();
    //         } else if (response.output[0].name === "getUserDetailsByPhoneNo") {
    //             toolResult = await functions.getUserDetailsByPhoneNo(session.caller);
    //         } else if (response.output[0].name === "getAllOrders") {
    //             toolResult = await functions.getAllOrders();
    //         } else if (response.output[0].name === "getOrderById") {
    //             toolResult = await functions.getOrderById(args.orderId);
    //         } else {
    //             toolResult = { error: "Unknown tool requested." };
    //         }

    //         tool.push({
    //             type: "function_call_output",
    //             call_id: response.output[0].call_id,
    //             output: JSON.stringify({ toolResult })
    //         });

    //         response = await services.openai.responses.create({
    //             model: "gpt-4o-mini",
    //             instructions: session.prompt,
    //             input: tool,
    //             previous_response_id: session.lastResponseId
    //         });
    //         session.lastResponseId = response.id;
    //     }

    //     session.lastResponseId = response.id;


    //     const messages = response.output || [];
    //     const assistantMessage = messages.find(m => m.role === "assistant");

    //     let parsedData;
    //     try {
    //         parsedData = JSON.parse(assistantMessage.content[0].text);
    //         return { processedText: parsedData.response, outputType: parsedData.output_channel };
    //     } catch (error) {
    //         return {
    //             processedText: assistantMessage.content[0].text || "Sorry, I had trouble understanding. Could you please rephrase?",
    //             outputType: input.input_channel
    //         };
    //     }
    // },
    // async processInputVIA_CHAT_COMPLITION_API(input, session) {
    //     // Initialize conversation history if not exists
    //     if (!session.messages) {
    //         session.messages = [
    //             {
    //                 role: "system",
    //                 content: session.prompt
    //             }
    //         ];
    //     }

    //     // Add user message to conversation
    //     session.messages.push({
    //         role: "user",
    //         content: input.message
    //     });
    //     console.log("session.messages", session.messages);

    //     const createChatParams = {
    //         model: "gpt-4o-mini",
    //         messages: session.messages,
    //         tools: session.tools,
    //         tool_choice: "auto", // Let the model decide when to use tools
    //         max_tokens: CONFIG.GPT_MAX_TOKENS
    //     };

    //     let processTimeStart = Date.now();
    //     let response = await services.openai.chat.completions.create(createChatParams);
    //     let processTime = Date.now() - processTimeStart;
    //     console.log("LLmProcessTime", processTime);

    //     const assistantMessage = response.choices[0].message;

    //     // Add assistant's response to conversation history
    //     session.messages.push(assistantMessage);

    //     // Check if the assistant wants to call a function
    //     if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    //         // Process each tool call
    //         for (const toolCall of assistantMessage.tool_calls) {
    //             let toolResult;
    //             const args = JSON.parse(toolCall.function.arguments);

    //             if (toolCall.function.name === "getAllProducts") {
    //                 toolResult = await functions.getAllProducts();
    //             } else if (toolCall.function.name === "getUserDetailsByPhoneNo") {
    //                 toolResult = await functions.getUserDetailsByPhoneNo(session.caller);
    //             } else if (toolCall.function.name === "getAllOrders") {
    //                 toolResult = await functions.getAllOrders();
    //             } else if (toolCall.function.name === "getOrderById") {
    //                 toolResult = await functions.getOrderById(args.orderId);
    //             } else {
    //                 toolResult = { error: "Unknown tool requested." };
    //             }

    //             // Add tool result to conversation
    //             session.messages.push({
    //                 role: "tool",
    //                 tool_call_id: toolCall.id,
    //                 content: JSON.stringify(toolResult)
    //             });
    //         }

    //         // Get final response after tool execution
    //         response = await services.openai.chat.completions.create({
    //             model: "gpt-4o-mini",
    //             messages: session.messages,
    //             tools: session.tools,
    //             tool_choice: "auto",
    //             max_tokens: CONFIG.GPT_MAX_TOKENS
    //         });

    //         const finalAssistantMessage = response.choices[0].message;
    //         session.messages.push(finalAssistantMessage);

    //         // Parse and return the final response
    //         let parsedData;
    //         try {
    //             parsedData = JSON.parse(finalAssistantMessage.content);
    //             return {
    //                 processedText: parsedData.response,
    //                 outputType: parsedData.output_channel
    //             };
    //         } catch (error) {
    //             return {
    //                 processedText: finalAssistantMessage.content || "Sorry, I had trouble understanding. Could you please rephrase?",
    //                 outputType: input.input_channel
    //             };
    //         }
    //     }

    //     // No tool calls - return direct response
    //     let parsedData;
    //     try {
    //         parsedData = JSON.parse(assistantMessage.content);
    //         return {
    //             processedText: parsedData.response,
    //             outputType: parsedData.output_channel
    //         };
    //     } catch (error) {
    //         return {
    //             processedText: assistantMessage.content || "Sorry, I had trouble understanding. Could you please rephrase?",
    //             outputType: input.input_channel
    //         };
    //     }
    // },

    async processInput(input, session) {
        return aiService.processInput(input, session, functions, toolDefinitions);
    },

    async addSystemMessage(input, session) {
        return aiService.addSystemMessage(input, session);
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
        return aiService.processTextToSpeech(processedText, session);
    }

};

const setChannel = (connection, session, channel) => {
    if (!session.availableChannel.some(c => c.channel === channel)) {
        session.availableChannel.push({
            channel: channel,
            connection: connection
        });
        let user = userStorage.findUser(session.name)
        console.log("user:", user)
        let prompt = `
Hey You are an Agent who can communicate through many channels, using the variable "output_channel" in your response.
The communication channels are: ${session.availableChannel.map(c => c.channel).join(", ")}
There is the system who will inform you the user actions.

## This is the User Prompt:
${session.prompt}

## User Data:
${user ? `Name: ${user.Name}
Email: ${user.Email}
Phone No: ${user.Phone}s` : `This is the Temp User with User Name: ${session.userName}`}

## Output Format:
Respond with ONLY a valid JSON object in this exact format:
{
    "response": "Your response",
    "output_channel": "communication channel"
}
- DO NOT include any explanation or text before or after the JSON.
- Your response MUST be valid JSON and parsable.

## Example Output:
If the user ask For an SMS then use the channel sms to send the sms:
{"response": "SMS Contents", "output_channel": "sms"}
If the user ask for any other channel then send by that channel:
{"response": "Your response", "output_channel": "other_channel"}
Remember, output must be STRICTLY JSON only.

only hangup the call when user says to hangup.
`;

        session.prompt = prompt;
    } else {
        session.availableChannel.forEach((c) => {
            if (c.channel === channel) {
                c.connection = connection
            }
        })
        let user = userStorage.findUser(session.name)
        console.log("user:", user)
        let prompt = `
Hey You are an Agent who can communicate through many channels, using the variable "output_channel" in your response.
The communication channels are: ${session.availableChannel.map(c => c.channel).join(", ")}
There is the system who will inform you the user actions.

## This is the User Prompt:
${session.prompt}

## User Data:
${user ? `Name: ${user.Name}
Email: ${user.Email}
Phone No: ${user.Phone}s` : "This is the Temp User"}

## Output Format:
Respond with ONLY a valid JSON object in this exact format:
{
    "response": "Your response",
    "output_channel": "communication channel"
}
- DO NOT include any explanation or text before or after the JSON.
- Your response MUST be valid JSON and parsable.

## Example Output:
If the user ask For an SMS then use the channel sms to send the sms:
{"response": "SMS Contents", "output_channel": "sms"}
If the user ask for any other channel then send by that channel:
{"response": "Your response", "output_channel": "other_channel"}
Remember, output must be STRICTLY JSON only.

only hangup the call when user says to hangup.
`;

        session.prompt = prompt;
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

async function sendSMS(to, message, session, input_channel) {
    try {
        const sms = await services.twilio.messages.create({
            body: message,
            from: '+17752888591',
            to: to
        });

        console.log('SMS sent successfully:', sms.sid);
        sendSystemMessage(session, `This message : "${message}" was sent successfully to the user tell the user that you have sent the message.`, input_channel);
        return sms;
    } catch (error) {
        console.error('Error sending SMS:', error);
        throw error;
    }
}

const handleOutput = async (session, response, output_channel, input_channel) => {
    output_channel = output_channel ? output_channel : input_channel
    if (output_channel == "audio") {
        handleInterruption(session); // Stop any ongoing AI speech
        let TTSTimeStart = Date.now()
        const audioBuffer = await aiProcessing.synthesizeSpeech3(response, session.id);
        let TTSTime = Date.now() - TTSTimeStart
        console.log("TTSTime", TTSTime)
        if (!audioBuffer) throw new Error("Failed to synthesize speech.");
        audioUtils.universalStreamAudio(session.availableChannel.find(con => con.channel == 'audio').connection, audioBuffer, session);
    } else if (output_channel == "chat") {
        session.availableChannel.find(con => con.channel == 'chat').connection.send(JSON.stringify({
            event: 'media',
            type: 'text_response',
            media: { payload: response },
            latency: session.metrics
        }));
    } else if (output_channel == "sms") {
        console.log(session.phoneNo)
        console.log("user", session.phoneNo)
        sendSMS(session.phoneNo, response, session, input_channel)
    } else if (output_channel == "system") {
        console.log("system response")
    }

    session.isAIResponding = false;

}

const sendSystemMessage = async (session, message, channel) => {
    const { processedText, outputType } = await aiProcessing.processInput(
        { message: message, input_channel: channel },
        session
    )

    await handleOutput(session, processedText, outputType, channel);
}










// ................................. ------ Livekit Room For Web Call ------ .................................


// Initialize Express server
const app = express();
app.use(cors({
    origin: ['https://call.shipfast.studio', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
}));
app.use(bodyParser.urlencoded({ extended: false }));
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

app.post('/create-room', async (req, res) => {
    try {
        const { roomName, participantName, userData, prompt, tool } = req.body;

        if (!roomName || !participantName) {
            return res.status(400).json({ error: 'roomName and participantName are required' });
        }

        console.log("toolssssssssssssssss", tool)

        // 1. Create room
        await roomService.createRoom({
            name: roomName,
            emptyTimeout: 20 * 60, // 20 minutes
            maxParticipants: 2,
        });

        // 2. Join room as agent
        const room = new Room();
        const agentToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: 'AI-Agent',
        });
        agentToken.addGrant({ roomJoin: true, room: roomName });
        const agentJwt = await agentToken.toJwt();

        await room.connect(LIVEKIT_URL, agentJwt, {
            autoSubscribe: true
        });

        // 3. Create session for this room
        const session = sessionManager.createSession(roomName, userData, prompt, tool);
        setChannel(room, session, "audio")
        session.caller = userData;

        // 4. Set up room event handlers
        realtime.setupRoomEventHandlers(room, session, {
            RoomEvent,
            sendSystemMessage,
            setupAudioProcessingForParticipant,
            setChannel,
            handleTrackSubscribed,
            handleChatInput: realtime.handleChatInput,
            sessionManager
        });

        // 5. Generate token for the user (participant)
        const userToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: participantName
        });
        userToken.addGrant({ roomJoin: true, room: roomName });
        const userJwt = await userToken.toJwt();

        // 6. Respond with token and session data
        res.json({
            success: true,
            sessionId: session.id,
            message: 'Room created, agent joined, and token generated',
            token: userJwt,
            prompt: prompt
        });

    } catch (error) {
        console.error('Error creating room and generating token:', error);
        res.status(500).json({ error: 'Failed to create room and generate token' });
    }
});

const telephony = require('./modules/telephony');
app.post('/call', (req, res) => telephony.handleOutboundCall(req, res, services, twilio));

app.post('/voice', (req, res) => telephony.handleVoiceWebhook(req, res, twilio));

// app.post('/bulk-call', (req, res) => {

// })


const realtime = require('./modules/realtime');

// Chat handlers moved to modules/realtime.js

async function handleTrackSubscribed(track, publication, participant, session) {
    if (track.kind === TrackKind.KIND_AUDIO) {
        console.log(`Subscribed to ${participant.identity} 's audio track`);

        const stream = new AudioStream(track,
            {
                noiseCancellation: NC.NoiseCancellation(),
                backgroundVoiceCancellation: NC.BackgroundVoiceCancellation(),
                telephonyBackgroundVoiceCancellation: NC.TelephonyBackgroundVoiceCancellation()
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
                try {
                    if (session.ffmpegProcess) {
                        session.ffmpegProcess.stdin.write(buf);
                    }
                } catch (error) {
                    console.log("Error in writting the buffer.")
                }
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

    const { startVADProcess } = require('./modules/vad');
    session.vadProcess = startVADProcess();
    // console.log('VAD process PID:', session.vadProcess);
    session.ffmpegProcess.stdout.pipe(session.vadProcess.stdin);
    session.ffmpegProcess.stderr.on('data', (data) => {
        console.error("Error in ffmpeg", data.toString());
    });

    session.vadProcess.stdout.on('data', (vadData) => {
        // console.log("VAD raw data received");

        // Add new data to buffer
        session.vadOutputBuffer += vadData.toString();

        // Split by lines
        const lines = session.vadOutputBuffer.split('\n');

        // Keep the last incomplete line in buffer
        session.vadOutputBuffer = lines.pop() || '';

        // Process each complete line
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
                const parsedVAD = JSON.parse(trimmedLine);
                // console.log(`Session ${session.id}: VAD Event: ${parsedVAD.event}`);

                if (parsedVAD.event === 'speech_start') {
                    session.isVadSpeechActive = true;
                    console.log(`Session ${session.id}: VAD detected Speech START. Resetting Deepgram buffer.`);
                    session.vadDeepgramBuffer = Buffer.alloc(0);
                } else if (parsedVAD.event === 'speech_end') {
                    session.isVadSpeechActive = false;
                    console.log(`Session ${session.id}: VAD detected Speech END.`);

                    // Send any remaining buffered audio
                    if (session.vadDeepgramBuffer.length > 0 && session.dgSocket?.readyState === 1) {
                        session.dgSocket.send(session.vadDeepgramBuffer);
                        session.vadDeepgramBuffer = Buffer.alloc(0);
                    }

                    // Introduce a small delay before sending the Finalize message
                    setTimeout(() => {
                        if (session.dgSocket?.readyState === 1) {
                            // console.log(`Session ${session.id}: Sending Deepgram Finalize message after delay.`);
                            session.dgSocket.send(JSON.stringify({ "type": "Finalize" }));
                        }
                    }, 200); // A 100ms delay is usually sufficient
                }



                // Handle audio chunks
                if (parsedVAD.chunk) {
                    // console.log(`Session ${session.id}: Got speech chunk (${parsedVAD.chunk.length / 2} chars)`);
                    const audioBuffer = Buffer.from(parsedVAD.chunk, 'hex');
                    session.vadDeepgramBuffer = Buffer.concat([session.vadDeepgramBuffer, audioBuffer]);

                    // Send chunks to Deepgram if speech is active
                    if (session.isVadSpeechActive && session.dgSocket?.readyState === 1) {
                        while (session.vadDeepgramBuffer.length >= CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE) {
                            // console.log("Sending chunk to Deepgram")
                            const chunkToSend = session.vadDeepgramBuffer.slice(0, CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                            session.dgSocket.send(chunkToSend);
                            session.vadDeepgramBuffer = session.vadDeepgramBuffer.slice(CONFIG.DEEPGRAM_STREAM_CHUNK_SIZE);
                            session.audioStartTime = Date.now();
                        }
                    }
                }
            } catch (err) {
                console.log(`Session ${session.id}: Failed to parse VAD line: "${trimmedLine}"`);
                console.error(`Session ${session.id}: VAD output parse error:`, err.message);
            }
        }
    });

    session.vadProcess.stderr.on('data', (data) => {
        // These are just log messages, not errors
        const message = data.toString().trim();
        if (message.includes('ERROR')) {
            console.error(`Session ${session.id}: VAD Error: ${message}`);
        } else {
            console.log(`Session ${session.id}: VAD Info: ${message}`);
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
        `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-3&language=en&punctuate=true&interim_results=true&endpointing=50`,
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
                let turnTimeStart = Date.now()

                turnDetector.CheckEndOfTurn({ messages: messagesForDetection }, (err, response) => {
                    (async () => {
                        let turnTime = Date.now() - turnTimeStart
                        console.log("turnTime", turnTime)
                        if (err) {
                            console.error('❌ gRPC Error:', err);
                        } else {
                            if (response.end_of_turn) {
                                console.log(`Session ${session.id}: ✅ Turn complete.`);
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
                                }, 1000)
                            }
                        }
                    })();
                });
                // let end = detectTurnEnd(session.currentUserUtterance)
                // console.log("end", end)
                // if (end) {
                //     if (!session.isVadSpeechActive) {
                //         await handleTurnCompletion(session);
                //     }
                // }
                // else {
                //     // console.log("turn not complete")
                //     session.isTalking = false

                //     setTimeout(async () => {
                //         if (!session.isTalking && !session.isVadSpeechActive) {
                //             await handleTurnCompletion(session)
                //         }
                //     }, 1000)
                // }
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

        await handleOutput(session, processedText, outputType, "audio")
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
    // let announcementText = session.chatHistory[0].content;

    // // await audioUtils.deepgramTtsToLiveKit(session.room, announcementText, session);
    // const mp3Buffer = await aiProcessing.synthesizeSpeech3(announcementText, session.id);
    // if (mp3Buffer) {

    //     audioUtils.universalStreamAudio(session.availableChannel.find(con => con.channel == 'audio').connection, mp3Buffer, session);

    // }
    // await aiProcessing.processTextToSpeech(announcementText, session);
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





// ...................................Sms Route...................................

async function handleIncomingMessage(fromNumber, message) {
    let session = sessionManager.createSession(null, fromNumber);
    // setChannel(null,session,"sms")
    // console.log("session recieved",session)
    const { processedText, outputType } = await aiProcessing.processInput(
        { message: message, input_channel: 'sms' },
        session
    );

    // console.log(processedText, outputType)
    if (outputType == "sms") {
        return processedText
    } else {
        handleOutput(session, processedText, outputType, "sms")
    }
}



app.post('/sms', async (req, res) => {
    console.log("SMS recieved")
    const incomingMessage = req.body.Body;
    const fromNumber = req.body.From;
    const toNumber = req.body.To;

    console.log("incomingMessage", incomingMessage)
    console.log("fromNumber", fromNumber)
    console.log("toNumber", toNumber)

    console.log(`Received SMS from ${fromNumber}: ${incomingMessage}`);

    // Process the incoming message
    const reply = await handleIncomingMessage(fromNumber, incomingMessage);
    console.log(reply)

    // Respond with TwiML (optional - to send auto-reply)
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.type('text/xml');
    res.send(twiml.toString());
});

//................................................................................



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















//................................. ------ Web Socket Part ------ .................................

const wss = new WebSocket.Server({ port: 5002 });
console.log("✅ WebSocket voice server started on ws://localhost:5002");

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

            await handleOutput(session, processedText, outputType, "audio")

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

                    let turnTime = Date.now();

                    turnDetector.CheckEndOfTurn({ messages: messagesForDetection }, (err, response) => {
                        (async () => {
                            console.log("turnTime: ", Date.now() - turnTime);
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
                                    }, 1000)
                                }
                            }
                        })();
                    });

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
                setInterval(() => {
                    ws.send(JSON.stringify({
                        type: "Ping",
                        streamSid: session.streamSid
                    }))
                }, 10000)

                let userData = parsedData.start?.customParameters?.caller || parsedData.userData;
                session = sessionManager.createSession(ws, userData, parsedData.start?.customParameters?.prompt, parsedData.tools); // Pass ws to session manager
                sessionId = session.id;
                session.callSid = parsedData.start?.callSid;
                session.streamSid = parsedData?.streamSid; // Confirm streamSid in session
                session.caller = parsedData.start?.customParameters?.caller || userData;
                session.recall_url = parsedData.start?.customParameters?.recall_url || null
                session.prompt = parsedData.start?.customParameters?.prompt || "You have called the User for greeting them";
                session.userName = parsedData.start?.customParameters?.name || "User don't have a name just greet them with the Sir"

                setChannel(ws, session, "audio")
                
                // console.log(session.caller);
                console.log(`Session ${sessionId}: Twilio stream started for CallSid: ${session.callSid}`);

                sendSystemMessage(session, `${session.name} have joined via PhoneCall, Talk to the User`, "audio");
                ws.send(JSON.stringify({
                    type: "current_prompt",
                    streamSid: session.streamSid,
                    prompt: "prompt",
                    functions: toolDefinitions
                }))

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

                const { startVADProcess } = require('./modules/vad');
                session.vadProcess = startVADProcess(); // Use module wrapper
                session.ffmpegProcess.stdout.pipe(session.vadProcess.stdin); // Pipe FFmpeg output to VAD input
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
                                setTimeout(() => {
                                    if (!session.isVadSpeechActive) {
                                        console.log(`Session ${session.id}: Sending Deepgram Finalize message.`);
                                        session.dgSocket.send(JSON.stringify({ "type": "Finalize" }));
                                    }
                                }, 200)
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
                connectToDeepgram(session);

                // Connect to Deepgram after processes are set up

                // Send initial announcement

                // const userDetails = await functions.getUserDetailsByPhoneNo(session.caller);
                // console.log(userDetails);
                // let announcementText = session.chatHistory[0].content; // Get initial message from chat history
                // if (userDetails) {
                //     announcementText = `Hello ${userDetails.firstName}, welcome to the Gautam Garments. How can I help you today?`;
                // }

                // const mp3Buffer = await aiProcessing.synthesizeSpeech3(announcementText, session.id);
                // if (mp3Buffer) {

                //     audioUtils.universalStreamAudio(session.availableChannel.find(con => con.channel == 'audio').connection, mp3Buffer, session);

                // }

            } else if (parsedData.event === 'media' && parsedData.media?.payload) {
                if (session && session.ffmpegProcess && session.ffmpegProcess.stdin.writable) {
                    const audioBuffer = Buffer.from(parsedData.media.payload, 'base64');
                    session.ffmpegProcess.stdin.write(audioBuffer); // Write to this session's ffmpeg
                }
            } else if (parsedData.event === 'change_prompt') {
                console.log('session', session.streamSid)
                console.log('prompt', parsedData.prompt)
                changePrompt(session, parsedData.prompt, parsedData.tools, ws)
            }
            // ws.send(JSON.stringify({
            //     type: "conversationHistory",
            //     streamSid: session.streamSid,
            //     conversation: session.chatHistory? session.chatHistory: []
            // }))
        } catch (err) {
            console.error(`Session ${sessionId}: Error processing Twilio WebSocket message:`, err);
        }
    });

    ws.on('close', async () => {
        console.log(`Session ${sessionId}: Twilio client disconnected.`);
        if (sessionId) {
            if (session.recall_url) {
                console.log(session.recall_url)
                const res = await fetch(session.recall_url, {
                    method: "post",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        {
                            "status": "Call Completed",
                            "phone": session.caller,
                            "conversation": session.chatHistory
                        }
                    )
                })
                const data = await res.json();
                console.log(data)
            }
            sessionManager.cleanupSession(session);
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















//................................. ------ Chat Part ------ .................................


const wssChat = new WebSocket.Server({ port: 5003 });
console.log("✅ WebSocket chat server started on ws://localhost:5003");


wssChat.on('connection', (ws, req) => {
    console.log("🎧 New Chat connected.");
    let sessionId = null; // Will be set once 'start' event is received
    let session = null; // Reference to the session object
    ws.on('message', async (data) => {
        try {
            const parsedData = JSON.parse(data);

            if (parsedData.event === 'start') {
                setInterval(() => {
                    ws.send(JSON.stringify({
                        type: "Ping",
                        streamSid: session.streamSid
                    }))
                }, 10000)
                // console.log('start',parsedData);
                let userData = parsedData.start?.customParameters?.caller || parsedData.userData;
                session = sessionManager.createSession(ws, userData, parsedData.prompt, parsedData.tools); // Pass ws to session manager
                sessionId = session.id;// Confirm streamSid in session
                session.caller = parsedData.start?.customParameters?.caller;

                setChannel(ws, session, "chat")
                sendSystemMessage(session, `${session.name} have joined via Chat`, "chat");
                // console.log(session.caller);
                console.log(`Session ${sessionId}: Twilio stream started for CallSid: ${session.callSid}`);
                ws.send(JSON.stringify({
                    type: "current_prompt",
                    streamSid: session.streamSid,
                    prompt: session.prompt,
                    functions: toolDefinitions
                }))
                // let announcementText = session.chatHistory[0].content; // Get initial message from chat history

                // session.availableChannel.find(con => con.channel == 'chat').connection.send(JSON.stringify({
                //     event: 'media',
                //     type: 'text_response',
                //     media: { payload: announcementText },
                //     latency: session.metrics
                // }));
            } else if (parsedData.event === 'media' && parsedData.media?.payload) {
                if (parsedData.type === 'chat') {
                    // console.log("chat recieved")
                    const { processedText, outputType } = await aiProcessing.processInput(
                        { message: parsedData.media.payload, input_channel: 'chat' },
                        session
                    );
                    await handleOutput(session, processedText, outputType, "chat")
                }
            } else if (parsedData.event === 'change_prompt') {
                console.log('session', session.streamSid)
                console.log('prompt', parsedData.prompt)
                changePrompt(session, parsedData.prompt, parsedData.tools, ws)
            }
            // Add other event types if necessary (e.g., 'stop', 'mark')
        } catch (err) {
            console.error(`Session ${sessionId}: Error processing Chat WebSocket message:`, err);
        }
    });

    ws.on('close', () => {
        console.log(`Session ${sessionId}: chat client disconnected.`);
    });

    ws.on('error', (error) => {
        console.error(`Session ${sessionId}: chat client error:`, error);
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
            console.log('WebSocket chat server closed.');
            process.exit(0);
        });
    }, 500);
});