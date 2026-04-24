const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { createClient, LiveTTSEvents } = require('@deepgram/sdk');
// const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require("@google/genai");
const { DEEPGRAM_API, GEMINI_API } = require('../config/index.js');

const deepgramTts = createClient(DEEPGRAM_API);
const genAI = new GoogleGenAI({ apiKey: GEMINI_API });

const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema")

const responseSchema = z.object({
  response : z.string().describe("response for the user input"),
  output_channel: z.string().describe("channel for the output reponse."),
});


const services = {
  polly: new PollyClient({ region: 'us-east-1' }),
  gemini: genAI
};

async function processInput(input, session, functions, toolDefinitions) {
  if (!session.messages) {
    session.messages = [];
  }
  session.messages.push({ role: 'user', parts: [{ text: `${input.message}   --end:${input.input_channel}` }] });

  // if (session.userid) {
  //   // 1. Retrieve relevant memories
  //   const userId = session.userid;
  //   let memoryContext = '';
  //   try {
  //     const memories = await memoryService.searchMemory(input.message, userId);
  //     if (memories?.results?.length > 0) {
  //       memoryContext = '\n\n## Relevant Memories about this user:\n' +
  //         memories.results.map(m => `- ${m.memory}`).join('\n');
  //     }
  //   } catch (e) { console.error('Memory search error:', e.message); }
  // }

  const geminiRequest = {
    model: "gemini-3.1-flash-lite-preview",
    contents: session.messages,
    tools: session.tools && session.tools.length > 0 ? [{ functionDeclarations: session.tools }] : undefined,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
    config: {
      temperature: 0.2,
      // response_mime_type: "application/json",
      responseMimeType: "application/json",
      responseJsonSchema: zodToJsonSchema(responseSchema),
      // response_schema: {
      //   type: "object",
      //   properties: {
      //     response: { type: "string" },
      //     output_channel: { type: "string" }
      //   },
      //   required: ["response", "output_channel"]
      // },
      systemInstruction: session.prompt ? { parts: [{ text: session.prompt }] } : undefined,
    },
    // config:{
    // }
  };
  console.log("session.prompt", session.prompt);
  let response = await services.gemini.models.generateContent(geminiRequest);
  console.log("response:-", response)
  const candidate = response.candidates[0];
  const assistantContent = candidate.content;
  session.messages.push({ role: 'model', parts: assistantContent.parts });

  const functionCalls = assistantContent.parts.filter((part) => part.functionCall);
  if (functionCalls.length > 0) {
    const functionResponses = [];
    for (const part of functionCalls) {
      let toolResult;
      const functionCall = part.functionCall;
      const args = functionCall.args || {};
      if (functionCall.name === 'getAllProducts') {
        toolResult = await functions.getAllProducts();
      } else if (functionCall.name === 'getUserDetailsByPhoneNo') {
        toolResult = await functions.getUserDetailsByPhoneNo(args.phoneNo);
      } else if (functionCall.name === 'getAllOrders') {
        toolResult = await functions.getAllOrders(args.phoneNo);
      } else if (functionCall.name === 'getOrderById') {
        toolResult = await functions.getOrderById(args.orderId);
      } else if (functionCall.name === 'cancelOrder') {
        const options = {
          reason: args.reason || 'OTHER',
          email: args.email !== undefined ? args.email : true,
          refund: args.refund !== undefined ? args.refund : true,
          restock: args.restock !== undefined ? args.restock : true,
        };
        toolResult = await functions.cancelOrder(args.orderId, options);
      } else if (functionCall.name === 'hangUp') {
        toolResult = await functions.endCall(session.room);
      } else {
        toolResult = { error: 'Unknown function requested.' };
      }
      functionResponses.push({ functionResponse: { name: functionCall.name, response: { toolResult } } });
    }

    session.messages.push({ role: 'user', parts: functionResponses });
    const finalRequest = {
      contents: session.messages,
      tools: toolDefinitions ? [{ functionDeclarations: toolDefinitions }] : undefined,
      generationConfig: { temperature: 0.5 },
      systemInstruction: session.prompt ? { parts: [{ text: session.prompt }] } : undefined,
    };
    response = await services.gemini.generateContent(finalRequest);
    const finalCandidate = response.response.candidates[0];
    const finalAssistantContent = finalCandidate.content;
    session.messages.push({ role: 'model', parts: finalAssistantContent.parts });
    const textPart = finalAssistantContent.parts.find((part) => part.text);
    const responseText = textPart ? textPart.text : '';
    try {
      const parsedData = JSON.parse(responseText);
      return { processedText: parsedData.response, outputType: parsedData.output_channel };
    } catch {
      return { processedText: responseText || 'Sorry, I had trouble understanding. Could you please rephrase?', outputType: input.input_channel };
    }
  }

  const textPart = assistantContent.parts.find((part) => part.text);
  const responseText = textPart ? textPart.text : '';
  try {
    const parsedData = JSON.parse(responseText);
    return { processedText: parsedData.response, outputType: parsedData.output_channel };
  } catch {
    return { processedText: responseText || 'Sorry, I had trouble understanding. Could you please rephrase?', outputType: input.input_channel };
  }
}

async function addSystemMessage(input, session) {
  if (!session.messages) session.messages = [];
  session.messages.push({ role: 'system', parts: [{ text: `${input.message}` }] });
  const geminiRequest = {
    contents: session.messages,
    tools: session.tools && session.tools.length > 0 ? [{ functionDeclarations: session.tools }] : undefined,
    generationConfig: { temperature: 0.2 },
    systemInstruction: session.prompt ? { parts: [{ text: session.prompt }] } : undefined,
  };
  const response = await services.gemini.generateContent(geminiRequest);
  const candidate = response.response.candidates[0];
  const assistantContent = candidate.content;
  session.messages.push({ role: 'model', parts: assistantContent.parts });
  const textPart = assistantContent.parts.find((part) => part.text);
  const responseText = textPart ? textPart.text : '';
  try {
    const parsedData = JSON.parse(responseText);
    return { processedText: parsedData.response, outputType: parsedData.output_channel };
  } catch {
    return { processedText: responseText || 'Sorry, I had trouble understanding. Could you please rephrase?', outputType: input.input_channel };
  }
}

async function synthesizeSpeech(text, sessionId) {
  // Deepgram TTS request returning mp3 Buffer
  const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const response = await deepgramTts.speak.request({ text }, { model: 'aura-2-thalia-en', encoding: 'mp3' });
  const stream = await response.getStream();
  if (!stream) throw new Error('Deepgram speak.getStream failed');
  return streamToBuffer(stream);
}

async function synthesizeSpeech2(text, sessionId, voiceId, gabberApiKey) {
  const res = await fetch('https://api.gabber.dev/v1/voice/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gabberApiKey}` },
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!res.ok) throw new Error(`Gabber error ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function synthesizeSpeech3(text) {
  const cmd = new SynthesizeSpeechCommand({ Text: text, VoiceId: 'Joanna', OutputFormat: 'mp3' });
  const data = await services.polly.send(cmd);
  return Buffer.from(await data.AudioStream.transformToByteArray());
}

async function synthesizeSpeechStream(text, sessionId, onChunkCallback) {
  return new Promise((resolve, reject) => {
    const dgConnection = deepgramTts.speak.live({ model: 'aura-2-thalia-en', encoding: 'linear16', sample_rate: 16000, container: 'none' });
    let leftoverBuffer = null;
    dgConnection.on(LiveTTSEvents.Open, () => { dgConnection.sendText(text); dgConnection.flush(); });
    dgConnection.on(LiveTTSEvents.Audio, async (data) => {
      const chunkArray = new Uint8Array(data);
      let combinedArray = leftoverBuffer ? new Uint8Array(leftoverBuffer.length + chunkArray.length) : chunkArray;
      if (leftoverBuffer) { combinedArray.set(leftoverBuffer); combinedArray.set(chunkArray, leftoverBuffer.length); leftoverBuffer = null; }
      let bytesToProcess = combinedArray.length;
      if (bytesToProcess % 2 !== 0) { leftoverBuffer = new Uint8Array([combinedArray[bytesToProcess - 1]]); bytesToProcess -= 1; }
      if (bytesToProcess > 0) {
        const pcmArray = new Int16Array(combinedArray.buffer.slice(combinedArray.byteOffset, combinedArray.byteOffset + bytesToProcess));
        await onChunkCallback(pcmArray);
      }
    });
    dgConnection.on(LiveTTSEvents.Flushed, async () => {
      if (leftoverBuffer) {
        const finalArray = new Uint8Array(2); finalArray.set(leftoverBuffer); finalArray[1] = 0;
        await onChunkCallback(new Int16Array(finalArray.buffer));
      }
      dgConnection.requestClose();
      resolve(true);
    });
    dgConnection.on(LiveTTSEvents.Error, reject);
  });
}

async function processTextToSpeech(processedText, session) {
  const { streamPCMAudioToLiveKit } = require('../utils/audio');
  const addAudioChunk = streamPCMAudioToLiveKit(
    session.room,
    session,
    () => { }
  );
  await synthesizeSpeechStream(processedText, session.id, addAudioChunk);
}

module.exports = {
  processInput,
  addSystemMessage,
  synthesizeSpeech,
  synthesizeSpeech2,
  synthesizeSpeech3,
  synthesizeSpeechStream,
  processTextToSpeech,
};


