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
let sessionSettings = {
    width: 800,
    height: 600,
    fps: 8,
    maxFrames: 20
};

// Frame Data History
// Note: If maxFrames changes, we might need to resize this array.
let globalFrames = Array(sessionSettings.maxFrames).fill().map(() => []);

// Serve static files (admin interface)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // Ensure JSON body parsing

// API Routes
app.get('/ping', (req, res) => {
    res.json({
        message: 'pong'
    });
});

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        sessionKey,
        connections: connections.size,
        settings: sessionSettings
    });
});

app.post('/api/settings', (req, res) => {
    const { width, height, fps, maxFrames } = req.body;

    // Update settings
    if (width) sessionSettings.width = parseInt(width);
    if (height) sessionSettings.height = parseInt(height);
    if (fps) sessionSettings.fps = parseInt(fps);

    if (maxFrames) {
        const newMax = parseInt(maxFrames);
        if (newMax !== sessionSettings.maxFrames) {
            sessionSettings.maxFrames = newMax;
            // Resize globalFrames history
            // If shrinking, we lose frames. If growing, we add empty arrays.
            if (newMax > globalFrames.length) {
                // Grow
                const added = Array(newMax - globalFrames.length).fill().map(() => []);
                globalFrames = globalFrames.concat(added);
            } else {
                // Shrink
                globalFrames = globalFrames.slice(0, newMax);
            }
        }
    }

    console.log('[Central] Session Settings Updated:', sessionSettings);

    // Broadcast new settings to all clients
    const msg = JSON.stringify({
        type: 'settings_update',
        settings: sessionSettings
    });

    connections.forEach(ws => {
        if (ws.readyState === 1) ws.send(msg);
    });

    res.json({ success: true, settings: sessionSettings });
});

app.post('/api/regenerate', (req, res) => {
    sessionKey = randomUUID();
    console.log(`[Central] New Session Key Generated: ${sessionKey}`);

    // Disconnect all clients as the key has changed
    connections.forEach(ws => {
        ws.send(JSON.stringify({ type: 'system', message: 'Session key changed. Disconnecting.' }));
        ws.close(1008, 'Session Key Changed');
    });

    // Optional: Clear history on key regeneration? 
    // Usually a new session means a clean slate.
    globalFrames = Array(sessionSettings.maxFrames).fill().map(() => []);

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

    // Send Current Settings
    ws.send(JSON.stringify({
        type: 'settings_update',
        settings: sessionSettings
    }));

    // Send Initial Snapshot of History
    // We send it as a series of drawing_updates or a single snapshot type?
    // Client currently handles 'drawing_update'. To minimize client changes, 
    // let's send a bulk drawing_update for EACH frame that has content.
    // Or we could implement a 'snapshot' type if we updated the client.
    // Let's stick to 'drawing_update' compatibility to start.

    console.log('[Central] Sending history snapshot to new client...');
    let totalPathsSent = 0;

    globalFrames.forEach((paths, index) => {
        if (paths.length > 0) {
            const msg = {
                type: 'drawing_update',
                frameIndex: index,
                paths: paths,
                sender: 'CENTRAL_HISTORY'
            };
            ws.send(JSON.stringify(msg));
            totalPathsSent += paths.length;
        }
    });
    console.log(`[Central] Snapshot sent (${totalPathsSent} paths).`);


    ws.on('error', console.error);

    ws.on('message', function message(data, isBinary) {
        // Broadcast to all other clients
        const msgString = isBinary ? data : data.toString();
        // console.log(`[Central] Broadcasting: ${msgString.substring(0, 50)}...`);

        // Parse and Store History
        try {
            const parsed = JSON.parse(msgString);
            if (parsed.type === 'drawing_update' && Array.isArray(parsed.paths)) {
                // Default to frame 0 if not specified
                const fIndex = (typeof parsed.frameIndex === 'number') ? parsed.frameIndex : 0;

                if (fIndex >= 0 && fIndex < MAX_FRAMES) {
                    parsed.paths.forEach(p => globalFrames[fIndex].push(p));
                }
            } else if (parsed.type === 'clear_frame') {
                // Future feature: handle clear
                // const fIndex = parsed.frameIndex;
                // globalFrames[fIndex] = [];
            }
        } catch (e) {
            // Non-JSON message, or system message we don't store
        }

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
