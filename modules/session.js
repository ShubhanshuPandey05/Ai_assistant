const WebSocket = require('ws');
const { Room } = require('@livekit/rtc-node');
const { userStorage } = require('./userStore');

function generateRandomIdFromData(data, length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < length; i++) {
        randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${data}-${randomStr}`;
}

class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    createSession(roomName, userData, prompt, tool = []) {
        let user = userStorage.findUser(userData);
        if (user) {
            if (user.ActiveSessionId && this.sessions.has(user.ActiveSessionId)) {
                let currentSession = this.getSession(user.ActiveSessionId);
                currentSession.room = roomName;
                currentSession.tools = [...tool, { name: 'hangUp', description: 'Hang up the call', parameters: { type: 'object', properties: {}, required: [] } }];
                currentSession.prompt = prompt;
                return currentSession;
            }
            const id = generateRandomIdFromData(userData);
            const session = this._buildSession(id, roomName, user.Name, user.Phone, prompt, tool);
            userStorage.setActiveSession(userData, id);
            this.sessions.set(id, session);
            return session;
        }
        const id = generateRandomIdFromData('temp');
        const session = this._buildSession(id, roomName, 'User', '', prompt, tool, true);
        this.sessions.set(id, session);
        return session;
    }

    _buildSession(id, roomName, name, phone, prompt, tool, isTemp = false) {
        return {
            id,
            room: roomName,
            name,
            dgSocket: null,
            lastTranscript: '',
            transcriptBuffer: [],
            audioStartTime: null,
            lastInterimTime: Date.now(),
            isSpeaking: false,
            lastInterimTranscript: '',
            interimResultsBuffer: [],
            streamSid: '',
            callSid: '',
            isAIResponding: false,
            currentAudioStream: null,
            interruption: false,
            lastInterruptionTime: 0,
            interruptionCooldown: 200,
            lastResponseId: null,
            phoneNo: phone,
            availableChannel: isTemp ? [] : [{ channel: 'sms' }],
            chatHistory: isTemp ? [{ role: 'assistant', content: 'Hello! You are speaking to an AI assistant.' }] : [],
            prompt: prompt || 'You are ai assistant.',
            metrics: { llm: 0, stt: 0, tts: 0 },
            ffmpegProcess: null,
            vadProcess: null,
            turndetectionprocess: null,
            vadDeepgramBuffer: Buffer.alloc(0),
            isVadSpeechActive: false,
            currentUserUtterance: '',
            isTalking: false,
            tools: [...tool, { name: 'hangUp', description: 'Hang up the call', parameters: { type: 'object', properties: {}, required: [] } }],
            message: []
        };
    }

    getSession(roomName) {
        return this.sessions.get(roomName);
    }

    deleteSession(roomName) {
        const session = this.sessions.get(roomName);
        if (session) {
            this.cleanupSession(session);
            this.sessions.delete(roomName);
        }
    }

    cleanupSession(session) {
        if (session) {
            if (session.dgSocket?.readyState === 1) {
                session.dgSocket.close();
            }
            if (session.ffmpegProcess) {
                session.ffmpegProcess.stdin.end();
                session.ffmpegProcess.kill('SIGINT');
            }
            if (session.vadProcess) {
                session.vadProcess.stdin.end();
                session.vadProcess.kill('SIGINT');
            }
            if (session.currentAudioStream && typeof session.currentAudioStream.stop === 'function') {
                session.currentAudioStream.stop();
            }
            if (session.prompt) {
                session.prompt = '';
            }
            // session.isAIResponding = false;
        }
    }
}

module.exports = { SessionManager };



