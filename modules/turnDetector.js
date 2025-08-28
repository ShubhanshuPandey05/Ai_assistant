const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './turn.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
const turnProto = grpc.loadPackageDefinition(packageDefinition).turn;

const client = new turnProto.TurnDetector('localhost:50051', grpc.credentials.createInsecure());

function checkEndOfTurn(messages) {
  return new Promise((resolve) => {
    client.CheckEndOfTurn({ messages }, (err, res) => {
      if (err) { resolve(false); return; }
      resolve(Boolean(res?.end_of_turn));
    });
  });
}

module.exports = { client, checkEndOfTurn };



