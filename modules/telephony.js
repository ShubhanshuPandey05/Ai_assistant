function handleOutboundCall(req, res, services, twilioLib) {
  const sid = req.body.twilio_sid;
  const token = req.body.twilio_token;
  let twilioc = services.twilio;
  if (sid && token) {
    twilioc = new twilioLib(sid, token);
  }
  const name = req.body.name || '';
  const prompt = req.body.prompt || '';
  const recall_url = req.body.recall_url || '';
  const to = req.body.to;
  const from = req.body.from || '+17752888591';
  const url = `https://call-server.shipfast.studio/livekit/voice?name=${encodeURIComponent(name)}&prompt=${encodeURIComponent(prompt)}&recall_url=${encodeURIComponent(recall_url)}`;
  twilioc.calls
    .create({ url, to, from })
    .then(call => console.log(call.sid))
    .catch(err => console.error('Twilio call error:', err))
    .finally(() => res.status(201).json({ message: 'Called this user' }));
}

function handleVoiceWebhook(req, res, twilioLib) {
  let callerNumber = req.body.From;
  if (req.body.Caller === '+17752888591') {
    callerNumber = req.body.To;
  }
  let name = req.query.name;
  let prompt = req.query.prompt;
  let recall_url = req.query.recall_url;
  const wsUrl = `wss://call-server.shipfast.studio/websocket/`;
  const response = new twilioLib.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: wsUrl });
  stream.parameter({ name: 'caller', value: callerNumber });
  stream.parameter({ name: 'name', value: decodeURIComponent(name) });
  stream.parameter({ name: 'prompt', value: decodeURIComponent(prompt) });
  stream.parameter({ name: 'recall_url', value: decodeURIComponent(recall_url) });
  response.say('Have a Good day');
  res.type('text/xml');
  res.send(response.toString());
}

module.exports = { handleOutboundCall, handleVoiceWebhook };


