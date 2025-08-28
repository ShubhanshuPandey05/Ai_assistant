require('dotenv').config();

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

function getShopifyGraphQLEndpoint(version = '2025-07') {
  if (!SHOPIFY_STORE_URL) return '';
  return `https://${SHOPIFY_STORE_URL}/admin/api/${version}/graphql.json`;
}

module.exports = {
  // Providers
  DEEPGRAM_API: process.env.DEEPGRAM_API,
  GEMINI_AI: process.env.GEMINI_AI,
  OPEN_AI: process.env.OPEN_AI,
  GABBER_API_KEY: process.env.GABBER_API_KEY,

  // Twilio
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER: process.env.TWILIO_NUMBER,

  // LiveKit
  LIVEKIT_URL: process.env.LIVEKIT_URL || 'ws://localhost:7880',
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || 'devkey',
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || 'secret',

  // AWS
  AWS_ACCESS_KEY_ID: process.env.accessKeyId,
  AWS_SECRET_ACCESS_KEY: process.env.secretAccessKey,

  // Shopify
  SHOPIFY_STORE_URL,
  SHOPIFY_ACCESS_TOKEN,
  getShopifyGraphQLEndpoint,
};


