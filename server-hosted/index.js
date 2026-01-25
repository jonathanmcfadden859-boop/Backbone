import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8060;
const CENTRAL_URL = (process.env.CENTRAL_SERVER_URL || process.env.CENTRAL_URL || 'wss://framed-intl.org').replace(/\/$/, '');
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
            .replace('src="js/svg-utils.js"', `src="js/svg-utils.js?v=${BUILD_ID}"`)
            .replace('href="css/style.css"', `href="css/style.css?v=${BUILD_ID}"`);

        res.send(result);
    });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Track all client connections
const clients = new Map(); // browserWs -> { centralWs, sessionKey, clientId }
let clientIdCounter = 0;

// Handle browser client connections
wss.on('connection', (browserWs) => {
    const clientId = ++clientIdCounter;
    console.log(`[HOSTED] Browser client ${clientId} connected`);

    const clientData = {
        centralWs: null,
        sessionKey: null,
        clientId: clientId,
        reconnectTimer: null,
        heartbeatInterval: null
    };
    clients.set(browserWs, clientData);

    // Handle messages from browser
    browserWs.on('message', (message) => {
        try {
            const rawData = message.toString();
            const data = JSON.parse(rawData);

            // Handle session key setup
            if (data.type === 'set_session_key' || data.t === 'set_session_key') {
                const sessionKey = data.key || data.sessionKey;
                console.log(`[HOSTED] Client ${clientId} setting session key: ${sessionKey}`);
                clientData.sessionKey = sessionKey;
                connectToCentral(browserWs, clientData);
                return;
            }

            // Forward all other messages to central server, wrapped with sender ID
            if (clientData.centralWs && clientData.centralWs.readyState === WebSocket.OPEN) {
                const payload = JSON.stringify({
                    sender: `HOSTED_CLIENT_${clientId}`,
                    content: rawData,
                    timestamp: Date.now()
                });
                clientData.centralWs.send(payload);
            } else {
                console.log(`[HOSTED] Client ${clientId}: Central not connected, ignoring message`);
            }
        } catch (e) {
            console.error(`[HOSTED] Client ${clientId} message parse error:`, e);
        }
    });

    // Handle browser disconnect
    browserWs.on('close', () => {
        console.log(`[HOSTED] Browser client ${clientId} disconnected`);
        if (clientData.heartbeatInterval) {
            clearInterval(clientData.heartbeatInterval);
        }
        if (clientData.centralWs) {
            clientData.centralWs.close();
        }
        if (clientData.reconnectTimer) {
            clearTimeout(clientData.reconnectTimer);
        }
        clients.delete(browserWs);
    });

    browserWs.on('error', (err) => {
        console.error(`[HOSTED] Browser client ${clientId} error:`, err);
    });

    // Send initial status
    browserWs.send(JSON.stringify({
        t: 'central_status',
        s: 'disconnected',
        url: ''
    }));
});

function connectToCentral(browserWs, clientData) {
    if (!clientData.sessionKey) {
        console.log(`[HOSTED] Client ${clientData.clientId}: No session key set`);
        return;
    }

    // Close existing connection if any
    if (clientData.heartbeatInterval) {
        clearInterval(clientData.heartbeatInterval);
    }
    if (clientData.centralWs) {
        clientData.centralWs.close();
    }

    const wsUrl = `${CENTRAL_URL}/?key=${clientData.sessionKey}`;
    console.log(`[HOSTED] Client ${clientData.clientId}: Connecting to central: ${wsUrl}`);

    const centralWs = new WebSocket(wsUrl);
    clientData.centralWs = centralWs;

    centralWs.on('open', () => {
        console.log(`[HOSTED] Client ${clientData.clientId}: Connected to central server`);

        // Start heartbeat for this client
        clientData.heartbeatInterval = setInterval(() => {
            if (centralWs.readyState === WebSocket.OPEN) {
                centralWs.send(JSON.stringify({
                    t: 'p',
                    sender: `HOSTED_CLIENT_${clientData.clientId}`,
                    ts: Date.now()
                }));
            }
        }, 30000);

        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({
                t: 'central_status',
                s: 'connected',
                url: CENTRAL_URL
            }));
        }
    });

    centralWs.on('message', (data, isBinary) => {
        const rawData = data.toString();
        try {
            const msg = JSON.parse(rawData);

            // Ignore messages from THIS specific browser client instance
            if (msg.sender === `HOSTED_CLIENT_${clientData.clientId}`) {
                return;
            }

            console.log(`[HOSTED] Client ${clientData.clientId}: Received from ${msg.sender || 'Central'}.`);

            // Unwrap if it's a wrapped message, otherwise use raw
            let payloadToSend = msg.content || rawData;

            // Forward to browser
            if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(payloadToSend);
            }
        } catch (e) {
            // Non-JSON or unsupported format
            if (browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(rawData);
            }
        }
    });

    centralWs.on('close', (code, reason) => {
        console.log(`[HOSTED] Client ${clientData.clientId}: Central connection closed. Code: ${code}, Reason: ${reason}`);
        if (clientData.heartbeatInterval) {
            clearInterval(clientData.heartbeatInterval);
        }

        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({
                t: 'central_status',
                s: 'disconnected',
                url: ''
            }));
        }

        // Auto-reconnect after 5 seconds if browser is still connected
        if (browserWs.readyState === WebSocket.OPEN && clientData.sessionKey) {
            clientData.reconnectTimer = setTimeout(() => {
                console.log(`[HOSTED] Client ${clientData.clientId}: Attempting reconnect...`);
                connectToCentral(browserWs, clientData);
            }, 5000);
        }
    });

    centralWs.on('error', (err) => {
        console.error(`[HOSTED] Client ${clientData.clientId}: Central WebSocket error:`, err.message);
        if (clientData.heartbeatInterval) {
            clearInterval(clientData.heartbeatInterval);
        }
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({
                t: 'central_status',
                s: 'error',
                url: '',
                error: err.message
            }));
        }
    });
}


server.listen(PORT, () => {
    console.log(`[HOSTED] Server listening on http://localhost:${PORT}`);
    console.log(`[HOSTED] Central URL: ${CENTRAL_URL}`);
    console.log(`[HOSTED] Ready to accept browser connections`);
});

