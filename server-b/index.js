import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = 8081;
const SERVER_ID = 'SERVER_B';
const app = express();
const CENTRAL_URL = process.env.CENTRAL_SERVER_URL || 'ws://localhost:8090';
app.use(express.json());

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.post('/api/connect', (req, res) => {
    const { key } = req.body;
    if (!key) {
        return res.status(400).json({ message: 'Missing key' });
    }

    console.log(`[${SERVER_ID}] CONFIG API: Received new session key.`);
    connectToCentral(key);
    res.json({ message: `Attempting to connect with key: ${key.substring(0, 8)}...` });
});

const server = createServer(app);

// Browser WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log(`[${SERVER_ID}] Local browser client connected.`);
    ws.on('message', (message) => {
        try {
            if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                const msgString = message.toString();
                sendMessage(currentWs, msgString);
            }
        } catch (e) {
            console.error('Error handling local message:', e);
        }
    });
});

server.listen(port, () => {
    console.log(`${SERVER_ID} listening on http://localhost:${port}`);
    promptForKey();
});

function promptForKey() {
    rl.question(`[${SERVER_ID}] Enter Session Key for Central: `, (key) => {
        connectToCentral(key.trim());
    });
}

// Central Server Connection Logic
let currentWs = null;
let wsClientStatus = 'disconnected';

app.get('/api/status', (req, res) => {
    res.json({ status: wsClientStatus });
});

async function connectToCentral(key) {
    if (currentWs) {
        console.log(`[${SERVER_ID}] Closing existing connection to connect with new key...`);
        currentWs.removeAllListeners();
        currentWs.close();
        currentWs = null;
        wsClientStatus = 'disconnected';
    }

    try {
        const wsUrl = `${CENTRAL_URL}?key=${key}`;
        console.log(`[${SERVER_ID}] Attempting WebSocket connection to: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);
        currentWs = ws;

        ws.on('open', () => {
            console.log(`[${SERVER_ID}] WebSocket Open: Connected to Central Hub successfully!`);
            wsClientStatus = 'connected';
            sendMessage(ws, JSON.stringify({ type: 'system', message: `Hello from ${SERVER_ID}!` }));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.sender === SERVER_ID) return;

                console.log(`[${SERVER_ID}] Received from ${msg.sender}. Forwarding...`);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(msg.content);
                    }
                });
            } catch (e) {
                console.log(`[${SERVER_ID}] Received raw/system: ${data}`);
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`[${SERVER_ID}] WebSocket Closed. Code: ${code}, Reason: '${reason}'`);
            wsClientStatus = 'disconnected';
            promptForKey();
        });

        ws.on('error', (err) => {
            console.error(`[${SERVER_ID}] WebSocket Error details:`, err);
            if (err.message.includes('401')) {
                console.error(`[${SERVER_ID}] ERROR: Dispatch returned 401. Check if your Session Key is correct.`);
            }
        });

    } catch (err) {
        console.error(`[${SERVER_ID}] Connect Logic Exception:`, err);
        wsClientStatus = 'disconnected';
        console.log(`[${SERVER_ID}] Please retry via CLI or Web Interface.`);
        promptForKey();
    }
}

function sendMessage(ws, text) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
            sender: SERVER_ID,
            content: text,
            timestamp: Date.now()
        });
        ws.send(payload);
    }
}
