async function fetchInfo() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('sessionKey').textContent = data.sessionKey;
        document.getElementById('connectionCount').textContent = data.connections;
    } catch (e) {
        console.error(e);
    }
}

async function regenerateKey() {
    if (!confirm('Are you sure? This will disconnect all current nodes.')) return;
    try {
        await fetch('/api/regenerate', { method: 'POST' });
        await fetchInfo();
    } catch (e) {
        console.error(e);
    }
}

// Poll every 2 seconds
fetchInfo();
setInterval(fetchInfo, 2000);
