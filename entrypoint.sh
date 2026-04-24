#!/bin/bash
set -e

echo "🚀 Starting AI Assistant services..."

# Start the Python gRPC Turn Detector in the background
echo "🟢 Starting Turn Detector gRPC server on port 50051..."
python3 grpc_server.py &
GRPC_PID=$!

# Wait briefly for the gRPC server to initialize
sleep 3

# Start the Node.js server (Express + WebSocket servers)
echo "🟢 Starting Node.js server..."
exec node server.js
