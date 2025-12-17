import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = 8080;
const SERVER_ID = 'SERVER_A';
const app = express();
const CENTRAL_URL = process.env.CENTRAL_SERVER_URL || 'ws://localhost:8090';

app.use(express.json());

const BUILD_ID = Date.now();

// Serve root manually to inject cache busters
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Internal Server Error');
        }
        // Inject cache buster params
        const result = data
            .replace('src="js/drawing.js"', `src="js/drawing.js?v=${BUILD_ID}"`)
            .replace('href="css/style.css"', `href="css/style.css?v=${BUILD_ID}"`);

        res.send(result);
    });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Configuration API
app.get('/config', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get('/api/status', (req, res) => {
    res.json({ status: wsClientStatus });
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

// Browser WebSocket Server (for drawing updates)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log(`[${SERVER_ID}] Local browser client connected.`);

    // Send current status immediately
    ws.send(JSON.stringify({
        type: 'central_status',
        status: wsClientStatus
    }));

    ws.on('message', (message) => {
        try {
            // Forward message from browser to Central
            // Ideally we check credentials or type, but for now we forward
            if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                // message is Buffer, convert to string
                const msgString = message.toString();
                sendMessage(currentWs, msgString);
                console.log(`[${SERVER_ID}] Forwarded drawing data to Central.`);
            } else {
                console.log(`[${SERVER_ID}] Cannot forward: Not connected to Central.`);
            }

            // Also echo back to other local browsers? 
            // The prompt says "broadcast... to the central. This way... it appears an all of the canvases".
            // If we only send to central, central will echo it back to OTHER servers.
            // Does Central echo back to the SENDER? 
            // "Ignore messages from self" in `ws.on('message')` prevents this. 
            // So we should broadcast to OTHER local browsers manually if we want them to see it, 
            // but for a single browser per server (likely use case), it's already on the user's screen.
            // If multiple tabs are open on Server A, they won't see it unless we broadcast locally too.
            // But let's stick to the main flow: Browser -> Server A -> Central -> Server B/C -> Browser.

        } catch (e) {
            console.error('Error handling local message:', e);
        }
    });
});

// We still listen on a port for the web interface
server.listen(port, () => {
    console.log(`${SERVER_ID} listening on http://localhost:${port}`);
    console.log(`[${SERVER_ID}] Waiting for Session Key via Web Interface (/config)...`);
});

// Central Server Connection Logic
let wsClientStatus = 'disconnected';
let currentWs = null;

async function connectToCentral(key) {
    if (currentWs) {
        console.log(`[${SERVER_ID}] Closing existing connection to connect with new key...`);
        currentWs.removeAllListeners(); // Prevent old handlers from firing reconnection logic
        currentWs.close();
        currentWs = null;
    }

    try {
        const wsUrl = `${CENTRAL_URL}?key=${key}`;
        console.log(`[${SERVER_ID}] Attempting WebSocket connection to: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);
        currentWs = ws;

        ws.on('open', () => {
            console.log(`[${SERVER_ID}] WebSocket Open: Connected to Central Hub successfully!`);
            wsClientStatus = 'connected';
            broadcastStatus('connected');

            // Send a hello message
            sendMessage(ws, JSON.stringify({ type: 'system', message: `Hello from ${SERVER_ID}!` }));

            // Start a specialized chatter loop for demo purposes
            /*
            const interval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    sendMessage(ws, JSON.stringify({ type: 'system', message: `Keep-alive ping from ${SERVER_ID}` }));
                } else {
                    clearInterval(interval);
                }
            }, 5000 + Math.random() * 2000); // Random interval
            */
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Ignore messages from self
                if (msg.sender === SERVER_ID) {
                    return;
                }

                console.log(`[${SERVER_ID}] Received from ${msg.sender || 'Central'}. Forwarding to local clients.`);

                // Determine if it's a drawing message or other
                // The content is a wrapped JSON string from other clients, 
                // OR a direct JSON object from Central (settings_update, history).

                let payloadToSend;
                if (msg.content) {
                    payloadToSend = msg.content;
                } else {
                    // Direct system message (settings_update, history snapshot)
                    payloadToSend = data.toString();
                }

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(payloadToSend);
                    }
                });

            } catch (e) {
                console.log(`[${SERVER_ID}] Received non-JSON or system message: ${data}`);
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`[${SERVER_ID}] WebSocket Closed. Code: ${code}, Reason: '${reason}'`);
            wsClientStatus = 'disconnected';
            console.log(`[${SERVER_ID}] Disconnected. Reconnect via Web Interface.`);
            broadcastStatus('disconnected');
        });

        ws.on('error', (err) => {
            console.error(`[${SERVER_ID}] WebSocket Error details:`, err);
            if (err.message.includes('401')) {
                console.error(`[${SERVER_ID}] ERROR: Dispatch returned 401. Check if your Session Key is correct.`);
            }
            // ws.close() will trigger the close handler, which prompts for key
        });

    } catch (err) {
        console.error(`[${SERVER_ID}] Connect Logic Exception:`, err);
        // Only prompt via CLI if this was a CLI flow or general failure, 
        // but for now it's fine to just log.
        console.log(`[${SERVER_ID}] Please retry via CLI or Web Interface.`);

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

function broadcastStatus(status) {
    const msg = JSON.stringify({
        type: 'central_status',
        status: status
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}
