# Backbone

# Framed Servers (Centralized WebSocket Network)

This project demonstrates a star topology network where nodes (Server A, B, C) communicate via a Central Hub.

## TODO

*   Figure out SVG export
*   Figure out session settings on connection issue
*   Currently works 100% for Chrome browser only 

## Architecture

*   **Central Server (Port 8090):**
    *   Acts as the WebSocket Message Hub.
    *   Generates and validates **Session Keys**.
    *   **Admin Interface:** `http://localhost:8090` (View/Regenerate Keys).

*   **Node Servers (A, B, C):**
    *   **Server A:** Port 8080 (Config: `http://localhost:8080/config.html`)
    *   **Server B:** Port 8081 (Config: `http://localhost:8081/config.html`)
    *   **Server C:** Port 8082 (Config: `http://localhost:8082/config.html`)
    *   **Behavior:** On startup, they wait for user input (either via Terminal OR via the Config Web Page).

## Usage

1.  **Start the Central Server:**
    ```bash
    npm run start:central
    ```
    *   Open `http://localhost:8090` to get the **Session Key**.

2.  **Start the Nodes:**
    ```bash
    npm run start:a
    npm run start:b
    npm run start:c
    ```

3.  **Connect the Nodes (Two Ways):**
    *   **Method 1 (CLI):** Paste the key into the terminal window for each server.
    *   **Method 2 (Web UI - NEW):** 
        *   Open `http://localhost:8080/config.html` (for Server A).
        *   Paste the key and click **Connect**.
        *   Repeat for B and C.

4.  **Regeneration:**
    *   If you regenerate the key at `http://localhost:8090`, all nodes disconnect.
    *   You can then use the Config Page (or CLI) to input the new key and reconnect without restarting the servers.
