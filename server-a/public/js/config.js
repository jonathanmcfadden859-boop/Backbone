const statusEl = document.getElementById('status');
const keyInput = document.getElementById('keyInput');

async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.status === 'connected') {
            statusEl.textContent = 'Connected! You can now use the drawing tool.';
            statusEl.style.color = 'green';
        } else {
            statusEl.textContent = 'Disconnected. Not connected to Central HW.';
            statusEl.style.color = 'red';
        }
    } catch (e) {
        statusEl.textContent = 'Error checking status.';
    }
}

// Poll status every 2 seconds
setInterval(checkStatus, 2000);
checkStatus();

async function connect() {
    const key = keyInput.value.trim();
    if (!key) return;

    console.log('[Config] Submitting key:', key);
    statusEl.textContent = 'Connecting...';
    statusEl.style.color = 'orange';

    try {
        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        console.log('[Config] /api/connect response status:', res.status);
        const data = await res.json();
        console.log('[Config] /api/connect response body:', data);

        statusEl.textContent = data.message;
    } catch (e) {
        console.error('[Config] Connection error:', e);
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.style.color = 'red';
    }
}
