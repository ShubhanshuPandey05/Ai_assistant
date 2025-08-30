function setupRoomEventHandlers(room, session, deps) {
  const { RoomEvent, sendSystemMessage, setupAudioProcessingForParticipant, setChannel, handleTrackSubscribed, handleChatInput } = deps;
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    sendSystemMessage(session, `${session.name} have joined via WebCall`, 'audio');
    setupAudioProcessingForParticipant(participant, session);
  });

  room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
    if (deps.sessionManager) deps.sessionManager.cleanupSession(session);
    await room.disconnect();
  });

  room.on(RoomEvent.Disconnected, () => {});

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    handleTrackSubscribed(track, publication, participant, session);
    setChannel(room, session, 'audio');
  });

  room.on(RoomEvent.ChatMessage, (message, participant) => {
    handleChatInput(message, participant, session, deps);
  });
}

async function handleChatInput(message, participant, session, deps) {
  try {
    const data = JSON.parse(message);
    if (data.type === 'chat') {
      await handleIncomingChat(data.content, participant, session, deps);
    }
  } catch (err) {
    console.error('Error parsing chat payload:', err);
  }
}

async function handleIncomingChat(message, participant, session, deps) {
  const { aiProcessing, audioUtils, Livekit } = deps;
  if (!session) return;
  if (!session.availableChannel.includes('chat')) {
    if (deps.setChannelSimple) deps.setChannelSimple(session, 'chat');
  }
  const { processedText, outputType } = await aiProcessing.processInput({ message, input_channel: 'chat' }, session);
  if (outputType === 'chat') {
    const replyPayload = JSON.stringify({ type: 'chat', content: processedText, from: 'ai-agent' });
    if (session.room && session.room.localParticipant && session.room.localParticipant.publishData) {
      session.room.localParticipant.publishData(replyPayload, (Livekit && Livekit.DataPacket_Kind && Livekit.DataPacket_Kind.RELIABLE) || 0, [participant.sid]);
    }
  } else if (outputType === 'audio') {
    // Immediately stop any existing audio stream to prioritize the latest
    if (session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
      console.log(`Session ${session.id}: Immediately stopping existing audio for latest audio`);
      try {
        session.currentAudioStream.stop();
      } catch (error) {
        console.error(`Session ${session.id}: Error stopping audio stream:`, error);
      }
    }
    
    // Force clear immediately - no waiting
    session.currentAudioStream = null;
    session.isAIResponding = false;
    session.interruption = false;
    
    const audioBuffer = await aiProcessing.synthesizeSpeech3(processedText, session.id);
    if (audioBuffer) {
      audioUtils.universalStreamAudio(session.room, audioBuffer, session);
    }
  }
}

module.exports = {
  setupRoomEventHandlers,
  handleChatInput,
  handleIncomingChat,
};


