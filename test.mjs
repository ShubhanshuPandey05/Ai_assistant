// const { spawn } = require('child_process');

// function generateSpeechLikeAudio(sampleRate, duration) {
//     const samples = sampleRate * duration;
//     const buffer = Buffer.alloc(samples * 2);
    
//     // Generate speech-like audio with multiple frequencies and modulation
//     for (let i = 0; i < samples; i++) {
//         const t = i / sampleRate;
        
//         // Mix multiple frequencies to simulate speech formants
//         let sample = 0;
//         sample += Math.sin(2 * Math.PI * 200 * t) * 0.3;  // F1 formant
//         sample += Math.sin(2 * Math.PI * 800 * t) * 0.2;  // F2 formant  
//         sample += Math.sin(2 * Math.PI * 2400 * t) * 0.1; // F3 formant
        
//         // Add amplitude modulation to simulate speech patterns
//         const modulation = Math.sin(2 * Math.PI * 5 * t) * 0.5 + 0.5; // 5Hz modulation
//         sample *= modulation;
        
//         // Add some noise for realism
//         sample += (Math.random() - 0.5) * 0.1;
        
//         // Scale and clip
//         sample = Math.max(-1, Math.min(1, sample));
//         const intSample = Math.floor(sample * 16384);
        
//         buffer.writeInt16LE(intSample, i * 2);
//     }
    
//     return buffer;
// }

// function testVADWithSpeechLike() {
//     console.log("Testing VAD with speech-like audio...");
    
//     const vadProcess = spawn('C:/Users/shubh/miniconda3/envs/vad-env/python.exe', ['vad.py'], {
//         stdio: ['pipe', 'pipe', 'pipe']
//     });
    
//     let vadOutput = '';
    
//     vadProcess.stdout.on('data', (data) => {
//         vadOutput += data.toString();
//         const lines = vadOutput.split('\n');
//         vadOutput = lines.pop();
        
//         for (const line of lines) {
//             if (line.trim()) {
//                 try {
//                     const event = JSON.parse(line);
//                     console.log(`✅ VAD Event: ${event.event}`);
//                     if (event.chunk) {
//                         console.log(`   📢 Audio chunk: ${event.chunk.length / 2} bytes`);
//                     }
//                     if (event.timestamps) {
//                         console.log(`   🎯 Timestamps:`, event.timestamps);
//                     }
//                 } catch (e) {
//                     console.log(`VAD Output: ${line}`);
//                 }
//             }
//         }
//     });
    
//     vadProcess.stderr.on('data', (data) => {
//         console.log(`VAD stderr: ${data}`);
//     });
    
//     vadProcess.on('exit', (code) => {
//         console.log(`VAD test completed with code: ${code}`);
//     });
    
//     // Generate speech-like audio
//     console.log("Generating speech-like audio...");
    
//     // Create a pattern: silence -> speech -> silence -> speech
//     const silence = Buffer.alloc(16000 * 0.3 * 2); // 0.3 seconds silence
//     const speech1 = generateSpeechLikeAudio(16000, 1.0); // 1 second speech
//     const speech2 = generateSpeechLikeAudio(16000, 0.8); // 0.8 seconds speech
    
//     const testAudio = Buffer.concat([silence, speech1, silence, speech2, silence]);
//     console.log(`Sending ${testAudio.length} bytes of test audio...`);
    
//     vadProcess.stdin.write(testAudio);
//     vadProcess.stdin.end();
// }

// function testRealAudioFile() {
//     console.log("\n=== Testing with real audio file (if available) ===");
    
//     const fs = require('fs');
//     const path = 'test.wav';
    
//     if (fs.existsSync(path)) {
//         console.log("Found test audio file, converting and testing...");
        
//         const ffmpeg = spawn('ffmpeg', [
//             '-i', path,
//             '-acodec', 'pcm_s16le',
//             '-ar', '16000',
//             '-ac', '1',
//             '-f', 's16le',
//             'pipe:1'
//         ], { stdio: ['pipe', 'pipe', 'pipe'] });
        
//         // Use the correct Python path
//         const vad = spawn('C:/Users/shubh/miniconda3/envs/vad-env/python.exe', ['vad.py'], {
//             stdio: ['pipe', 'pipe', 'pipe']
//         });
        
//         // Handle errors properly
//         ffmpeg.on('error', (err) => {
//             console.log('FFmpeg error:', err.message);
//         });
        
//         vad.on('error', (err) => {
//             console.log('VAD error:', err.message);
//         });
        
//         // Handle pipe errors
//         ffmpeg.stdout.on('error', (err) => {
//             console.log('FFmpeg stdout error:', err.message);
//         });
        
//         vad.stdin.on('error', (err) => {
//             console.log('VAD stdin error:', err.message);
//         });
        
//         ffmpeg.stdout.pipe(vad.stdin);
        
//         vad.stdout.on('data', (data) => {
//             const lines = data.toString().split('\n');
//             for (const line of lines) {
//                 if (line.trim()) {
//                     try {
//                         const event = JSON.parse(line);
//                         console.log(`🎵 Real Audio VAD: ${event.event}`);
//                         if (event.chunk) console.log(`   Audio: ${event.chunk.length / 2} bytes`);
//                         if (event.timestamps) console.log(`   Timestamps:`, event.timestamps);
//                     } catch (e) {
//                         console.log(`Real Audio Output: ${line}`);
//                     }
//                 }
//             }
//         });
        
//         vad.stderr.on('data', (data) => {
//             console.log(`Real Audio VAD stderr: ${data}`);
//         });
        
//         ffmpeg.stderr.on('data', (data) => {
//             // FFmpeg info - usually verbose, so we'll keep it quiet
//         });
        
//         vad.on('exit', (code) => {
//             console.log(`Real audio VAD test completed with code: ${code}`);
//         });
        
//     } else {
//         console.log("No test.wav file found, skipping real audio test");
//         console.log("To test with real audio, place a WAV file named 'test.wav' in this directory");
//     }
// }

// // Run the test
// testVADWithSpeechLike();

// // Test with real audio after 5 seconds
// setTimeout(testRealAudioFile, 5000);



// services/openai/responses.js
import 'dotenv/config';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPEN_AI });

const start = Date.now();

// Step 1: Define your function/tool
const tools = [
  {
    type: "function",
    name: "getAllProducts",
    description: "Get a list of all products in the store.",
    parameters: {
        type: "object",
        properties: {},
        required: []
    }
}
];

// Step 2: First API call — send prompt and tool
const stream = await openai.responses.create({
  model: "gpt-4o-mini",
  input: "Generate a random sentence.",
  tools,
  stream: true
});

let previousResponseId = null;
let toolCallId = null;

console.log("🟢 Streaming first part (tool call request):\n");

for await (const chunk of stream) {
  if (chunk.type === 'response.output_text.delta') {
    process.stdout.write(chunk.delta || '');
  }

  if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
    toolCallId = chunk.item.call_id;
    console.log("\n\n🛠️ Tool call received:", chunk.item.name, "\nID:", toolCallId);
  }

  if (chunk.type === 'response.completed') {
    previousResponseId = chunk.response.id;
  }
}

console.log("\n✅ First response completed.\n");

// Step 3: Simulate running the function (e.g., from DB)
const fakeProducts = [
  { name: "iPhone 14", price: "$999" },
  { name: "Samsung Galaxy S23", price: "$899" },
  { name: "Google Pixel 8", price: "$799" }
];

// Step 4: Second API call — send tool result
const followup = await openai.responses.create({
  model: "gpt-4o-mini",
  previous_response_id: previousResponseId,
  input: [
    {
      type: "function_call_output",
      call_id: toolCallId,
      output: JSON.stringify(fakeProducts)
    }
  ],
  stream: true
});

console.log("🟡 Streaming final assistant reply:\n");

for await (const chunk of followup) {
  if (chunk.type === 'response.output_text.delta') {
    process.stdout.write(chunk.delta || '');
  }
}

console.log("\n✅ Done in", Date.now() - start, "ms");
