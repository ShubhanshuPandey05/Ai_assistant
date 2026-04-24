# ============================================
# Stage 1: Build the React client
# ============================================
FROM node:20-slim AS client-builder

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ============================================
# Stage 2: Production image (Node + Python + FFmpeg)
# ============================================
FROM node:20-slim

# Install system dependencies: Python, FFmpeg, build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment
RUN python3 -m venv /opt/python_env
ENV PATH="/opt/python_env/bin:$PATH"

WORKDIR /app

# ------ Python dependencies ------
# Install core Python packages (pinned to match project needs)
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
    numpy \
    grpcio==1.73.0 \
    grpcio-tools==1.73.0 \
    transformers \
    optimum[onnxruntime] \
    onnxruntime

# Copy Python files
COPY vad.py turn.py grpc_server.py turn.proto ./
COPY turn_pb2.py turn_pb2_grpc.py ./

# Pre-download Silero VAD model so it's cached in the image
RUN python3 -c "import torch; torch.hub.load('snakers4/silero-vad', model='silero_vad', trust_repo=True)"

# ------ Node.js dependencies ------
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ------ Application code ------
COPY server.js telephony.js test.js ./
COPY config/ ./config/
COPY modules/ ./modules/
COPY routes/ ./routes/
COPY services/ ./services/
COPY utils/ ./utils/

# Copy ONNX models if they exist (for turn detection)
COPY onnx_model_3/ ./onnx_model_3/

# Copy built client from Stage 1
COPY --from=client-builder /app/client/dist ./client/dist

# ------ Entrypoint ------
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Expose ports:
#   5001 - Express HTTP API
#   5002 - WebSocket Voice (Twilio)
#   5003 - WebSocket Chat
EXPOSE 5001 5002 5003

ENTRYPOINT ["./entrypoint.sh"]
