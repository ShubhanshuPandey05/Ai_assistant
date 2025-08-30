function attachRoutes(app, deps) {
  const {
    roomService,
    Room,
    AccessToken,
    LIVEKIT_URL,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    sessionManager,
    setChannel,
    realtime,
    RoomEvent,
    sendSystemMessage,
    setupAudioProcessingForParticipant,
    handleTrackSubscribed,
    aiProcessing,
    handleOutput,
    twilio,
    userStorage,
  } = deps;

  app.post('/create-room', async (req, res) => {
    try {
      const { roomName, participantName, userData, prompt, tool } = req.body;
      if (!roomName || !participantName) {
        return res.status(400).json({ error: 'roomName and participantName are required' });
      }

      await roomService.createRoom({ name: roomName, emptyTimeout: 20 * 60, maxParticipants: 2 });
      const room = new Room();
      const agentToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: 'AI-Agent' });
      agentToken.addGrant({ roomJoin: true, room: roomName });
      const agentJwt = await agentToken.toJwt();
      await room.connect(LIVEKIT_URL, agentJwt, { autoSubscribe: true });

      const session = sessionManager.createSession(roomName, userData, prompt, tool);
      setChannel(room, session, 'audio');
      session.caller = userData;

      realtime.setupRoomEventHandlers(room, session, {
        RoomEvent,
        sendSystemMessage,
        setupAudioProcessingForParticipant,
        setChannel,
        handleTrackSubscribed,
        handleChatInput: realtime.handleChatInput,
        sessionManager,
      });

      const userToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: participantName });
      userToken.addGrant({ roomJoin: true, room: roomName });
      const userJwt = await userToken.toJwt();

      res.json({ success: true, sessionId: session.id, message: 'Room created, agent joined, and token generated', token: userJwt, prompt });
    } catch (error) {
      console.error('Error creating room and generating token:', error);
      res.status(500).json({ error: 'Failed to create room and generate token' });
    }
  });

  app.post('/change-prompt', async (req, res) => {
    try {
      const { userData, prompt, tools } = req.body;
      let user = userStorage.findUser(userData);
      if (!user) return res.status(400).json({ error: 'user is required' });
      const session = sessionManager.getSession(user.ActiveSessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const changePrompt = deps.changePrompt;
      changePrompt(session, prompt, tools);
      res.json({ success: true, message: 'Prompt updated successfully', prompt: session.prompt, functions: deps.toolDefinitions });
    } catch (error) {
      console.error('Error changing prompt:', error);
      res.status(500).json({ error: 'Failed to change prompt' });
    }
  });

  async function handleIncomingMessage(fromNumber, message) {
    let session = sessionManager.createSession(null, fromNumber);
    const { processedText, outputType } = await aiProcessing.processInput({ message, input_channel: 'sms' }, session);
    if (outputType == 'sms') return processedText;
    await handleOutput(session, processedText, outputType, 'sms');
    return processedText;
  }

  app.post('/sms', async (req, res) => {
    const incomingMessage = req.body.Body;
    const fromNumber = req.body.From;
    const reply = await handleIncomingMessage(fromNumber, incomingMessage);
    const tw = new twilio.twiml.MessagingResponse();
    tw.message(reply);
    res.type('text/xml');
    res.send(tw.toString());
  });
}

module.exports = { attachRoutes };


