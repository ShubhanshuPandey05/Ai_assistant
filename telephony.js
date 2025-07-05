const twilio = require('twilio');
require('dotenv').config();
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
client.calls.create({
  url: 'https://temp-vb4k.onrender.com/voice', // Endpoint that returns TwiML instructions
  // to: "+918780899485", // Recipient's phone number
  to: "+919313562780", // Recipient's phone number
  from: "+16812215320"// Your Twilio number
})
.then(call => console.log(call.sid));




// server {
//     listen 80;
//     server_name call-server.shipfast.studio;

//     # Proxy /livekit to port 5001
//     location /livekit/ {
//         proxy_pass http://localhost:5001/;
//         proxy_http_version 1.1;
//         proxy_set_header Upgrade $http_upgrade;
//         proxy_set_header Connection 'upgrade';
//         proxy_set_header Host $host;
//         proxy_cache_bypass $http_upgrade;
//         rewrite ^/livekit(/.*)$ $1 break;
//     }
  
//     # Proxy /websocket to port 5002
//     location /websocket/ {
//         proxy_pass http://localhost:5002/;
//         proxy_http_version 1.1;
//         proxy_set_header Upgrade $http_upgrade;
//         proxy_set_header Connection 'upgrade';
//         proxy_set_header Host $host;
//         proxy_cache_bypass $http_upgrade;
//         rewrite ^/websocket(/.*)$ $1 break;
//     }
// }
