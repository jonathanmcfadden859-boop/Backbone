# Hosted Client Server

This is the public-facing hosted server that allows multiple users to connect to the collaborative drawing session through their web browsers.

## Features

- **Multi-user support**: Each browser connection gets its own WebSocket relay to the central server
- **Session-based**: Users can join a session using a session key (via URL parameter or modal)
- **Real-time collaboration**: All users in the same session see each other's drawings in real-time
- **Same UI/UX**: Identical drawing interface to servers A, B, and C

## Usage

### Starting the Server

```bash
npm run start:hosted
```

The server will start on port 8090 by default (configurable via .env file).

### Connecting Users

Users can connect in two ways:

1. **Via URL parameter**:
   ```
   http://localhost:8090/?session=YOUR_SESSION_KEY
   ```

2. **Via modal**: Navigate to `http://localhost:8090/` and enter the session key in the modal that appears.

### Environment Variables

Create a `.env` file in the `server-hosted` directory:

```
PORT=8090
CENTRAL_URL=wss://framed-intl.org
```

## Architecture

```
User Browser 1 ←→ server-hosted (WebSocket) ←→ Central Server
User Browser 2 ←→ server-hosted (WebSocket) ←→ Central Server  
User Browser 3 ←→ server-hosted (WebSocket) ←→ Central Server
```

Each browser maintains its own WebSocket connection to the server-hosted, which then relays messages to/from the central server. All users in the same session collaborate on the same canvas.

## Deployment

This server is designed to be deployed to a cloud platform (e.g., Heroku, Railway, DigitalOcean) to allow public access.

### Deployment Checklist

1. Set `CENTRAL_URL` to your production central server URL
2. Configure `PORT` if needed (most platforms set this automatically)
3. Ensure WebSocket connections are supported by your hosting platform
4. Set up SSL/TLS for secure WebSocket connections (wss://)
