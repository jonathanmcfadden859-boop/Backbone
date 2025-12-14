async function fetchInfo() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('sessionKey').textContent = data.sessionKey;
        document.getElementById('connectionCount').textContent = data.connections;

        // Only update inputs if not focused (to allow typing)
        if (document.activeElement.tagName !== 'INPUT') {
            if (data.settings) {
                document.getElementById('width').value = data.settings.width;
                document.getElementById('height').value = data.settings.height;
                document.getElementById('fps').value = data.settings.fps;
                document.getElementById('maxFrames').value = data.settings.maxFrames;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function updateSettings() {
    const width = document.getElementById('width').value;
    const height = document.getElementById('height').value;
    const fps = document.getElementById('fps').value;
    const maxFrames = document.getElementById('maxFrames').value;

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ width, height, fps, maxFrames })
        });
        alert('Settings Updated & Broadcasted!');
        await fetchInfo();
    } catch (e) {
        console.error(e);
        alert('Error updating settings');
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
