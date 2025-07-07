const { createClient } = require('@deepgram/sdk');
const fs = require('fs');
const { pipeline } = require('stream/promises');
require('dotenv').config();

const text = `Hello how are you doing today?`;
const speak = async () => {
  const deepgramApiKey = process.env.DEEPGRAM_API;
  const outputFile = 'audio.mp3';
  const deepgram = createClient(deepgramApiKey);
  let timeStart = Date.now()

  const response = await deepgram.speak.request(
    { text },
    {
      model: 'aura-2-thalia-en',
    }
  );

  const stream = await response.getStream();
  if (stream) {
    const file = fs.createWriteStream(outputFile);
    try {
      let timeEnd = Date.now()
      console.log("Time taken", timeEnd - timeStart)
      await pipeline(stream, file);
      console.log(`Audio file written to ${outputFile}`);
    } catch (e) {
      console.error('Error writing audio to file:', err);
    }
  } else {
    console.error('Error generating audio:', stream);
  }
}
speak();
