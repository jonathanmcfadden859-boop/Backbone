const MAX_PALETTE_COLORS = 8;
let paletteColors = [];
let paletteDirty = false; // true while user has unsaved palette edits

function renderPalette() {
    const box = document.getElementById('paletteEditor');
    box.innerHTML = '';
    paletteColors.forEach((color, i) => {
        const row = document.createElement('div');
        row.className = 'palette-row';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.value = color;
        hex.maxLength = 7;
        hex.className = 'hex-input';
        picker.addEventListener('input', () => {
            paletteColors[i] = picker.value;
            hex.value = picker.value;
            paletteDirty = true;
        });
        hex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
                paletteColors[i] = hex.value.toLowerCase();
                picker.value = paletteColors[i];
                paletteDirty = true;
            } else {
                hex.value = paletteColors[i];
            }
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '✕';
        del.addEventListener('click', () => {
            paletteColors.splice(i, 1);
            paletteDirty = true;
            renderPalette();
        });
        row.append(picker, hex, del);
        box.appendChild(row);
    });
    document.getElementById('addColor').disabled = paletteColors.length >= MAX_PALETTE_COLORS;
}

document.getElementById('addColor').addEventListener('click', () => {
    if (paletteColors.length < MAX_PALETTE_COLORS) {
        paletteColors.push('#000000');
        paletteDirty = true;
        renderPalette();
    }
});
document.getElementById('clearPalette').addEventListener('click', () => {
    paletteColors = [];
    paletteDirty = true;
    renderPalette();
});

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
                if (!paletteDirty) {
                    paletteColors = [...(data.settings.palette || [])];
                    renderPalette();
                }
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
            body: JSON.stringify({ width, height, fps, maxFrames, palette: paletteColors })
        });
        paletteDirty = false;
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

// Copy logic
const keyDisplay = document.getElementById('sessionKey');
keyDisplay.title = "Click to copy session ID";
keyDisplay.addEventListener('click', async () => {
    const key = keyDisplay.textContent;
    if (key && key !== 'Loading...') {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(key);
            } else {
                // Fallback for non-secure contexts (e.g. HTTP other than localhost)
                const textArea = document.createElement("textarea");
                textArea.value = key;

                // Ensure it's not visible but part of DOM
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);

                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (!successful) {
                    throw new Error('Fallback copy failed.');
                }
            }

            // Visual feedback
            const originalBg = keyDisplay.style.backgroundColor;

            keyDisplay.style.backgroundColor = '#d1fae5'; // Light green
            keyDisplay.style.color = '#065f46'; // Dark green
            keyDisplay.textContent = 'Copied to Clipboard!';

            setTimeout(() => {
                keyDisplay.style.backgroundColor = originalBg;
                keyDisplay.style.color = '';
                keyDisplay.textContent = key;
            }, 1000);

        } catch (err) {
            console.error('Failed to copy: ', err);
            // alert('Failed to copy key to clipboard'); 
            // Alert might be annoying if it fails repeatedly, but let's keep it for feedback
            alert('Failed to copy. Please manually copy the key.');
        }
    }
});
