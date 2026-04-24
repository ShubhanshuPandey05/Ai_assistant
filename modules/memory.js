const { Memory } = require('mem0ai/oss');

const memory = new Memory({
    version: "v1.1",
    llm: {
        provider: "openai",           // uses OpenAI-compatible API
        config: {
            model: "llama3.1",
            openaiBaseUrl: "http://localhost:11434/v1",  // Ollama endpoint
            apiKey: "ollama",           // Ollama doesn't need a real key
        }
    },
    embedder: {
        provider: "openai",
        config: {
            model: "nomic-embed-text",
            openaiBaseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
        }
    },
    vectorStore: {
        provider: "qdrant",
        config: {
            host: "localhost",
            port: 6333,
            collectionName: "ai_assistant_memories",
        }
    },
    historyDbPath: "./memory_history.db"
});


class MemoryService {
    constructor() {
        this.memory = memory;
    }

    addMemory(messages, userId, metadata) {
        this.memory.addMemory(messages, userId, metadata);
    }

    searchMemory(query, userId) {
        this.memory.searchMemory(query, userId);
    }

    getUserMemories(userId) {
        this.memory.getUserMemories(userId);
    }

    deleteMemory(memoryId) {
        this.memory.deleteMemory(memoryId);
    }

    deleteUserMemories(userId) {
        this.memory.deleteUserMemories(userId);
    }
}