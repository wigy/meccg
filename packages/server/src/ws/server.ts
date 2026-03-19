import { WebSocketServer } from 'ws';
import { GameSession } from './game-session.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession();

console.log(`MECCG server listening on port ${PORT}`);
console.log('Waiting for two players to connect...');

wss.on('connection', (ws) => {
  console.log('Client connected');
  session.addConnection(ws);
});
