import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = 8090; // Central Server Port
const app = express();
const server = createServer(app);

// State
let sessionKey = randomUUID(); // Initial session key
let connections = new Set();

// Serve static files (admin interface)
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        sessionKey,
        connections: connections.size
    });
});

app.post('/api/regenerate', (req, res) => {
    sessionKey = randomUUID();
    console.log(`[Central] New Session Key Generated: ${sessionKey}`);

    // Disconnect all clients as the key has changed
    connections.forEach(ws => {
        ws.send(JSON.stringify({ type: 'system', message: 'Session key changed. Disconnecting.' }));
        ws.close(1008, 'Session Key Changed');
    });

    res.json({ success: true, sessionKey });
});

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const key = url.searchParams.get('key');

    if (key !== sessionKey) {
        console.log(`[Central] Connection Attempt Rejected. Invalid Key.`);
        console.log(`          Received: '${key}'`);
        console.log(`          Expected: '${sessionKey}'`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', function connection(ws) {
    connections.add(ws);
    console.log('[Central] Node connected');

    ws.on('error', console.error);

    ws.on('message', function message(data, isBinary) {
        // Broadcast to all other clients
        // We expect the message to happen to be JSON and include sender ID, but 
        // strictly speaking, the central hub just redistributes.
        // However, the prompt says "sends it out to all of the nodes at once".

        // We can parse it to log, but for efficiency/simplicity we can just blindly broadcast to everyone
        // The prompt says "ignores messages that come back to it with it's own id",
        // which implies we can just echo to everyone including sender, or everyone except sender.
        // "sends it out to ALL of the nodes at once" -> usually implies broadcast to all connected.

        const msgString = isBinary ? data : data.toString();
        console.log(`[Central] Broadcasting: ${msgString.substring(0, 50)}...`);

        connections.forEach(client => {
            if (client.readyState === 1) { // OPEN
                client.send(msgString, { binary: isBinary });
            }
        });
    });

    ws.on('close', () => {
        console.log('[Central] Node disconnected');
        connections.delete(ws);
    });
});

server.listen(port, () => {
    console.log(`Central Server listening on http://localhost:${port}`);
    console.log(`Current Session Key: ${sessionKey}`);
});
