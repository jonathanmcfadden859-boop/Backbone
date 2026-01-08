// State
let MAX_FRAMES = 20;
let frames = Array(MAX_FRAMES).fill().map(() => []); // Array of arrays of path objects
let currentFrameIndex = 0; // 0-based index
// Getter for backward compatibility and ease of use in current functions
Object.defineProperty(window, 'paths', {
    get: function () { return frames[currentFrameIndex]; },
    set: function (val) { frames[currentFrameIndex] = val; }
});

let FPS = 8;
let frameDuration = 1000 / FPS;

let currentPath = [];
let startX = 0;
let startY = 0;
let isDrawing = false;
let showSVG = false;
let lastTransmittedIndex = 0; // Note: this logic might need update for multi-frame sync later


// Brush State
let brushColor = '#000000';
let previousColor = '#000000'; // To restore after erasing
let brushSize = 3;
let brushOpacity = 1.0;
let activeTool = 'pencil'; // 'pencil' or 'eraser'

// DOM elements
const canvas = document.getElementById('canvas');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const transmitToggle = document.getElementById('transmitToggle');
let isLive = true;

// Toolbar Elements
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const colorSwatches = document.querySelectorAll('.color-swatch');
const primarySwatch = document.querySelector('.primary-swatch');
const colorGradient = document.querySelector('.color-gradient');
const colorGradientGray = document.querySelector('.color-gradient-gray');
const toolBtns = document.querySelectorAll('.tool-group .tool-btn'); // Select pencil/eraser buttons
const customCursor = document.getElementById('customCursor');

// Legacy Elements (might be missing in new UI, check existence)
const exportBtn = document.getElementById('exportBtn') || { disabled: false, addEventListener: () => { } };
const copyBtn = document.getElementById('copyBtn') || { disabled: false, addEventListener: () => { } };
const toggleBtn = document.getElementById('toggleBtn') || { textContent: '', addEventListener: () => { } };
const svgOutput = document.getElementById('svgOutput');
const pathList = document.getElementById('pathList');

// WebSocket Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
const ws = new WebSocket(wsUrl);

let localConnected = false;
let centralConnected = false;
let centralUrl = '';

ws.onopen = () => {
    console.log('Connected to server WebSocket');
    localConnected = true;
    updateConnectionStatus();
};

// Safety check for browsers that might have opened the socket before the event handler hung
if (ws.readyState === WebSocket.OPEN) {
    localConnected = true;
    updateConnectionStatus();
}

ws.onclose = () => {
    console.log('Disconnected from server WebSocket');
    localConnected = false;
    updateConnectionStatus();
};

ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    localConnected = false;
    updateConnectionStatus();
};

const connectionBadge = document.getElementById('connectionBadge');
const connectionInfo = document.getElementById('connectionInfo');

function updateConnectionStatus() {
    if (!connectionBadge || !connectionInfo) return;

    if (!localConnected) {
        connectionBadge.textContent = 'Offline';
        connectionBadge.className = 'status-badge offline';
        connectionInfo.textContent = 'Disconnected from Local Node';
        connectionInfo.style.color = '#ef4444';
        return;
    }

    // Connected to Node server, check Central
    if (centralConnected) {
        connectionBadge.textContent = 'Online';
        connectionBadge.className = 'status-badge online';
        connectionInfo.textContent = `Live Session Active (${centralUrl || 'Connecting...'})`;
        connectionInfo.style.color = '#e8eaed';
    } else {
        connectionBadge.textContent = 'Standby';
        connectionBadge.className = 'status-badge offline';
        connectionInfo.textContent = 'Connected to Node, but No Central Session';
        connectionInfo.style.color = 'orange';
    }
}

ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        // Compact keys: t=type, c=central_status, h=history_snapshot, u=drawing_update, s=settings_update
        const type = data.t || data.type;

        if (type === 'c' || type === 'central_status') {
            const status = data.s || data.status;
            centralUrl = data.url || centralUrl;
            centralConnected = (status === 'connected');
            updateConnectionStatus();
        } else if (type === 'h' || type === 'history_snapshot') {
            const snapshotFrames = data.f || data.frames;
            if (Array.isArray(snapshotFrames)) {
                console.log('Received history snapshot. Syncing frames.');
                frames = snapshotFrames.slice(0, MAX_FRAMES);
                if (frames[currentFrameIndex]) {
                    lastTransmittedIndex = frames[currentFrameIndex].length;
                }
                renderPaths();
                initFrameButtons();
            }
        } else if (type === 'u' || type === 'drawing_update') {
            const incomingPaths = data.p || data.paths;
            const targetFrameIndex = (typeof data.i === 'number') ? data.i : (typeof data.frameIndex === 'number' ? data.frameIndex : 0);

            if (incomingPaths && targetFrameIndex >= 0 && targetFrameIndex < MAX_FRAMES) {
                incomingPaths.forEach(p => frames[targetFrameIndex].push(p));

                if (targetFrameIndex === currentFrameIndex) {
                    lastTransmittedIndex += incomingPaths.length;
                    incomingPaths.forEach(pathData => {
                        const el = createPathElement(pathData);
                        canvas.appendChild(el);
                    });
                    updateButtons();
                    if (showSVG && svgOutput) updateSVGOutput();
                }
            }
        } else if (type === 'clear') {
            const targetFrameIndex = (typeof data.i === 'number') ? data.i : (typeof data.frameIndex === 'number' ? data.frameIndex : 0);
            if (targetFrameIndex >= 0 && targetFrameIndex < MAX_FRAMES) {
                console.log(`Received clear command for frame ${targetFrameIndex}`);
                frames[targetFrameIndex] = [];
                if (targetFrameIndex === currentFrameIndex) {
                    lastTransmittedIndex = 0;
                    renderPaths();
                    updateButtons();
                    if (showSVG && svgOutput) updateSVGOutput();
                }
            }
        } else if (type === 's' || type === 'settings_update') {
            const settings = data.s || data.settings;
            console.log('Received session settings update:', settings);
            if (settings) applySessionSettings(settings);
        }
    } catch (e) {
        // console.log('Received non-drawing message', event.data);
    }
};

function applySessionSettings(settings) {
    // 1. Update Canvas Dimensions
    if (settings.width && settings.height) {
        canvas.setAttribute('width', settings.width);
        canvas.setAttribute('height', settings.height);
        // Also update preview canvas viewBox for scaling
        const previewCanvas = document.getElementById('previewCanvas');
        if (previewCanvas) {
            previewCanvas.setAttribute('width', settings.width / 2); // Keep preview smaller? Or just aspect ratio?
            // Existing CSS hardcodes preview container size, let's just make sure viewBox is correct
            // Actually, existing logic: previewCanvas width=400 height=300.
            // Let's scale it to maintain aspect ratio relative to 400px width?
            // Or just set viewBox.
            previewCanvas.setAttribute('viewBox', `0 0 ${settings.width} ${settings.height}`);
            // Update preview pixel size if we want
            previewCanvas.setAttribute('width', 400);
            previewCanvas.setAttribute('height', 400 * (settings.height / settings.width));
        }

        // Update Info Text
        const infoSpan = document.querySelector('.canvas-info');
        if (infoSpan) {
            infoSpan.textContent = `Canvas: ${settings.width} x ${settings.height}px | Preview: ${settings.fps} FPS`;
        }
    }

    // 2. Update Framerate
    if (settings.fps) {
        FPS = settings.fps;
        frameDuration = 1000 / FPS;
        // Animation loop uses these global vars
    }

    // 3. Update Max Frames
    if (settings.maxFrames) {
        const newMax = parseInt(settings.maxFrames);
        if (newMax !== MAX_FRAMES) {
            const oldMax = MAX_FRAMES;
            MAX_FRAMES = newMax;

            // Resize frames array
            if (newMax > frames.length) {
                // Grow
                const added = Array(newMax - frames.length).fill().map(() => []);
                frames = frames.concat(added);
            } else {
                // Shrink (this loses data on the client side!)
                frames = frames.slice(0, newMax);
            }

            // Adjust current frame index if it's now out of bounds
            if (currentFrameIndex >= MAX_FRAMES) {
                switchFrame(MAX_FRAMES - 1);
            }

            // Update UI Labels
            const totalDisplay = document.getElementById('totalFramesDisplay');
            if (totalDisplay) totalDisplay.textContent = MAX_FRAMES;

            // Re-generate buttons
            initFrameButtons();
        }
    }
}

// ... (simplifyPoints logic remains largely unchanged) ...
function simplifyPoints(points, tolerance = 2) {
    if (points.length < 3) return points;
    const sqTolerance = tolerance * tolerance;
    const getSqDist = (p1, p2) => ((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    const getSqSegDist = (p, p1, p2) => {
        let x = p1.x, y = p1.y;
        let dx = p2.x - x, dy = p2.y - y;
        if (dx !== 0 || dy !== 0) {
            const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) { x = p2.x; y = p2.y; }
            else if (t > 0) { x += dx * t; y += dy * t; }
        }
        return (p.x - x) ** 2 + (p.y - y) ** 2;
    };
    const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
        let maxSqDist = sqTolerance;
        let index = 0;
        for (let i = first + 1; i < last; i++) {
            const sqDist = getSqSegDist(points[i], points[first], points[last]);
            if (sqDist > maxSqDist) { index = i; maxSqDist = sqDist; }
        }
        if (maxSqDist > sqTolerance) {
            if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
            simplified.push(points[index]);
            if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
        }
    };
    const last = points.length - 1;
    const simplified = [points[0]];
    simplifyDPStep(points, 0, last, sqTolerance, simplified);
    simplified.push(points[last]);
    return simplified;
}

// Convert points to smooth Bezier path
function pointsToBezier(points) {
    if (points.length < 2) return '';
    const simplified = simplifyPoints(points, 3);
    if (simplified.length < 2) return '';
    let path = `M ${simplified[0].x.toFixed(1)} ${simplified[0].y.toFixed(1)}`;
    if (simplified.length === 2) {
        path += ` L ${simplified[1].x.toFixed(1)} ${simplified[1].y.toFixed(1)}`;
        return path;
    }
    for (let i = 1; i < simplified.length - 1; i++) {
        const p0 = simplified[i - 1];
        const p1 = simplified[i];
        const p2 = simplified[i + 1];
        const cp1x = p0.x + (p1.x - p0.x) * 0.5;
        const cp1y = p0.y + (p1.y - p0.y) * 0.5;
        const cp2x = p1.x + (p2.x - p1.x) * 0.5;
        const cp2y = p1.y + (p2.y - p1.y) * 0.5;
        if (i === 1) {
            path += ` Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${((p1.x + cp2x) / 2).toFixed(1)} ${((p1.y + cp2y) / 2).toFixed(1)}`;
        } else {
            path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${((p1.x + cp2x) / 2).toFixed(1)} ${((p1.y + cp2y) / 2).toFixed(1)}`;
        }
    }
    const lastPoint = simplified[simplified.length - 1];
    const secondLast = simplified[simplified.length - 2];
    path += ` Q ${secondLast.x.toFixed(1)} ${secondLast.y.toFixed(1)} ${lastPoint.x.toFixed(1)} ${lastPoint.y.toFixed(1)}`;
    return path;
}

// Create SVG path element
// pathData can be a string (legacy), an object, or a compact array [d, color, size, opacity]
function createPathElement(pathData, isTemp = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    let d = '';
    let color = brushColor;
    let width = brushSize;
    let opacity = brushOpacity;
    let fill = 'none';

    if (Array.isArray(pathData)) {
        // [d, color, width, opacity, fill]
        d = pathData[0];
        color = pathData[1] || 'black';
        width = pathData[2] || 2;
        opacity = pathData[3] !== undefined ? pathData[3] : 1;
        fill = pathData[4] || 'none';
    } else if (typeof pathData === 'string') {
        d = pathData;
        color = 'black';
        width = 2;
        opacity = 1;
    } else {
        d = pathData.d;
        color = pathData.color || 'black';
        width = pathData.width || 2;
        opacity = pathData.opacity !== undefined ? pathData.opacity : 1;
        fill = pathData.fill || 'none';
    }

    if (isTemp) {
        color = brushColor;
        width = brushSize;
        opacity = brushOpacity;
        if (activeTool !== 'pencil') {
            fill = brushColor;
        }
    }

    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width);
    path.setAttribute('fill', fill);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', opacity);

    return path;
}

// Render all paths
function renderPaths() {
    while (canvas.firstChild) {
        canvas.removeChild(canvas.firstChild);
    }

    // Onion Skinning: Draw previous frame if it exists
    if (currentFrameIndex > 0) {
        const prevFrame = frames[currentFrameIndex - 1];
        prevFrame.forEach(pathData => {
            const el = createPathElement(pathData);
            // Override opacity for onion skin
            el.setAttribute('opacity', '0.3');
            // Optional: tint it or change style to distinguish?
            // For now just simpler opacity.
            canvas.appendChild(el);
        });
    }

    // Draw current frame paths
    // 'paths' accessor now returns frames[currentFrameIndex]
    paths.forEach(pathData => {
        canvas.appendChild(createPathElement(pathData));
    });

    if (isDrawing && currentPath.length > 1) {
        const bezierPath = pointsToBezier(currentPath);
        canvas.appendChild(createPathElement(bezierPath, true));
    }
}

function updateSVGOutput() {
    if (!pathList) return;
    pathList.innerHTML = '';
    paths.forEach((path, index) => {
        const d = Array.isArray(path) ? path[0] : (typeof path === 'string' ? path : path.d);
        const pathItem = document.createElement('div');
        pathItem.className = 'path-item';
        pathItem.innerHTML = `
            <div class="path-label">Path ${index + 1}:</div>
            <div>d="${d.substring(0, 50)}..."</div>
        `;
        pathList.appendChild(pathItem);
    });
}

function updateButtons() {
    const hasContent = paths.length > 0;
    if (exportBtn.style) exportBtn.disabled = !hasContent;
    if (copyBtn.style) copyBtn.disabled = !hasContent;
}

function startDrawing(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    currentPath = [{ x: startX, y: startY }];
}

function draw(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Remove existing temporary path element
    const tempPath = canvas.querySelector('.temp-path');
    if (tempPath) canvas.removeChild(tempPath);

    let d = '';
    if (activeTool === 'pencil') {
        currentPath.push({ x, y });
        d = pointsToBezier(currentPath);
    } else if (activeTool === 'square') {
        const w = x - startX;
        const h = y - startY;
        d = `M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${(startX + w).toFixed(1)} ${startY.toFixed(1)} L ${(startX + w).toFixed(1)} ${(startY + h).toFixed(1)} L ${startX.toFixed(1)} ${(startY + h).toFixed(1)} Z`;
    } else if (activeTool === 'circle') {
        const rx = Math.abs(x - startX) / 2;
        const ry = Math.abs(y - startY) / 2;
        const cx = (startX + x) / 2;
        const cy = (startY + y) / 2;
        d = `M ${cx.toFixed(1)} ${(cy - ry).toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${cx.toFixed(1)} ${(cy + ry).toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${cx.toFixed(1)} ${(cy - ry).toFixed(1)} Z`;
    }

    const el = createPathElement(d, true);
    el.classList.add('temp-path');
    canvas.appendChild(el);
}

function stopDrawing() {
    if (isDrawing) {
        const tempPath = canvas.querySelector('.temp-path');
        if (tempPath) {
            const d = tempPath.getAttribute('d');
            canvas.removeChild(tempPath);

            const fill = activeTool === 'pencil' ? 'none' : brushColor;

            const pathArray = [
                d,
                brushColor,
                activeTool === 'pencil' ? brushSize : 1, // thin border for filled shapes
                brushOpacity,
                fill
            ];

            paths.push(pathArray);
            canvas.appendChild(createPathElement(pathArray));

            updateButtons();
            if (showSVG) updateSVGOutput();
            if (isLive) transmitDrawing();
        }
    }
    isDrawing = false;
    currentPath = [];
}

function clearDrawing() {
    frames[currentFrameIndex] = [];
    currentPath = [];
    lastTransmittedIndex = 0;
    renderPaths();
    updateButtons();
    if (showSVG) updateSVGOutput();

    if (isLive && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            t: 'clear',
            i: currentFrameIndex
        }));
    }
}

function transmitDrawing() {
    if (paths.length > lastTransmittedIndex) {
        const newPaths = paths.slice(lastTransmittedIndex);
        const message = {
            t: 'u', // type: update
            i: currentFrameIndex, // frameIndex
            p: newPaths // paths
        };
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            lastTransmittedIndex = paths.length;
            updateButtons();
            console.log('Broadcasting ' + newPaths.length + ' new path(s)...');
        } else {
            console.log('WebSocket not connected, cannot transmit.');
        }
    }
}

function exportSVG() {
    const svgContent = canvas.outerHTML;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drawing.svg';
    a.click();
    URL.revokeObjectURL(url);
}

function copySVGCode() {
    const pathStrings = paths.map((path, i) => {
        let d = typeof path === 'string' ? path : path.d;
        let color = typeof path === 'object' ? path.color : 'black';
        let width = typeof path === 'object' ? path.width : 2;
        return `  <path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" />`;
    }).join('\n');

    const svgCode = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">\n${pathStrings}\n</svg>`;

    navigator.clipboard.writeText(svgCode).then(() => alert('SVG copied!')).catch(e => console.error(e));
}

function toggleSVGDisplay() {
    showSVG = !showSVG;
    if (svgOutput) svgOutput.classList.toggle('hidden', !showSVG);
    if (toggleBtn) toggleBtn.textContent = showSVG ? 'Hide SVG Paths' : 'Show SVG Paths';
    if (showSVG) updateSVGOutput();
}

// Setup Tool Listeners
function updateCursorSize() {
    if (customCursor) {
        // Size slider value is arbitrary (1-20), let's map it to pixels roughly appropriate for visibility or actual stroke width
        // stroke-width 1 means 1px.
        const width = brushSize;
        // Ensure minimum visibility (e.g. 4px)
        const diameter = Math.max(4, width);
        customCursor.style.width = `${diameter}px`;
        customCursor.style.height = `${diameter}px`;
    }
}

if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        if (sizeValue) sizeValue.textContent = brushSize;
        updateCursorSize();
    });
    // Initial size set
    updateCursorSize();
}

// Custom Cursor Tracking
if (customCursor) {
    document.addEventListener('mousemove', (e) => {
        // Only show if hovering canvas
        // (Actually, 'mousemove' on document is expensive, better to just update position if visible)
        // But to have it strictly "turn into" circle when ENTERING canvas:
        if (isCursorVisible) {
            customCursor.style.left = `${e.clientX}px`;
            customCursor.style.top = `${e.clientY}px`;
        }
    });
}
let isCursorVisible = false;

canvas.addEventListener('mouseenter', () => {
    isCursorVisible = true;
    if (customCursor) customCursor.style.display = 'block';
});
canvas.addEventListener('mouseleave', () => {
    isCursorVisible = false;
    if (customCursor) customCursor.style.display = 'none';
});

if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
        brushOpacity = parseInt(e.target.value) / 100;
        if (opacityValue) opacityValue.textContent = `${e.target.value}%`;
    });
}

if (colorSwatches) {
    colorSwatches.forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            // Update visual active state
            colorSwatches.forEach(s => s.classList.remove('active'));
            e.target.classList.add('active');

            // Update State
            const styleColor = e.target.style.backgroundColor;
            brushColor = styleColor;
            previousColor = styleColor;

            if (activeTool === 'eraser') {
                activeTool = 'pencil';
                updateToolButtons();
            }
        });
    });
}

// Color Picking Logic for Gradients
function pickColorFromGradient(e, isGrayscale) {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const percent = Math.max(0, Math.min(1, x / width));

    let pickedColor;

    if (isGrayscale) {
        // Linear interpolation from Black (0,0,0) to White (255,255,255)
        const val = Math.floor(percent * 255);
        pickedColor = `rgb(${val}, ${val}, ${val})`;
    } else {
        // Approximate the spectrum gradient: red -> orange -> yellow -> green -> blue -> indigo -> violet
        // Simplest approximation is HSL.
        // Hue goes 0 to ~280deg. We map 0-1 to 0-300ish to cover the rainbow.
        // Actually CSS linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet)
        // covers roughly 0 to 270-300 degrees of Hue.
        // Let's map 0-1 to 0-300.
        const hue = percent * 300;
        pickedColor = `hsl(${hue}, 100%, 50%)`;
    }

    // Update Primary Swatch
    if (primarySwatch) {
        primarySwatch.style.backgroundColor = pickedColor;
        // Ideally we select it too
        colorSwatches.forEach(s => s.classList.remove('active'));
        primarySwatch.classList.add('active');
    }

    // Update Brush
    brushColor = pickedColor;
    previousColor = pickedColor;

    if (activeTool === 'eraser') {
        activeTool = 'pencil';
        updateToolButtons();
    }
}

if (colorGradient) {
    colorGradient.addEventListener('click', (e) => pickColorFromGradient(e, false));
    // Optional: drag to pick? For now just click.
}

if (colorGradientGray) {
    colorGradientGray.addEventListener('click', (e) => pickColorFromGradient(e, true));
}

// Tool Selection (Pencil vs Eraser)
function updateToolButtons() {
    toolBtns.forEach(btn => {
        const title = btn.getAttribute('title').toLowerCase();
        if (title === activeTool) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

if (toolBtns) {
    toolBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const title = btn.getAttribute('title').toLowerCase();
            activeTool = title;

            if (activeTool === 'pencil' || activeTool === 'square' || activeTool === 'circle') {
                brushColor = previousColor;
                // without expensive geometric boolean operations on Bezier curves.
                const canvasBg = window.getComputedStyle(canvas).backgroundColor;
                brushColor = canvasBg || '#ffffff';
            }

            updateToolButtons();
        });
    });
    // Set initial active state
    updateToolButtons();
}


// Attach event listeners
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

// Action Buttons
if (clearBtn) clearBtn.addEventListener('click', clearDrawing);
if (saveBtn) saveBtn.addEventListener('click', exportSVG);
if (transmitToggle) {
    transmitToggle.addEventListener('change', (e) => {
        isLive = e.target.checked;
        // If switched to Live, send any pending updates immediately
        if (isLive) {
            transmitDrawing();
        }
    });
}
if (copyBtn.addEventListener) copyBtn.addEventListener('click', copySVGCode);
if (toggleBtn.addEventListener) toggleBtn.addEventListener('click', toggleSVGDisplay);

// Frame Logic
const frameGrid = document.getElementById('frameGrid');
const currentFrameDisplay = document.getElementById('currentFrameDisplay');

function switchFrame(index) {
    if (index < 0 || index >= MAX_FRAMES) return;
    currentFrameIndex = index;

    // Update UI
    if (currentFrameDisplay) currentFrameDisplay.textContent = index + 1;

    // Update active button
    const buttons = frameGrid.querySelectorAll('.frame-btn');
    buttons.forEach((btn, i) => {
        if (i === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // Reset transmission tracking for this frame (simplification for now)
    lastTransmittedIndex = frames[currentFrameIndex].length;

    renderPaths();
    updateButtons();
}

function initFrameButtons() {
    if (!frameGrid) return;
    frameGrid.innerHTML = ''; // Clear existing static buttons
    for (let i = 0; i < MAX_FRAMES; i++) {
        const btn = document.createElement('button');
        btn.className = 'frame-btn';
        if (i === 0) btn.classList.add('active');
        btn.textContent = i + 1;
        btn.addEventListener('click', () => switchFrame(i));
        frameGrid.appendChild(btn);
    }
}

// Initial render
initFrameButtons();
renderPaths();

// Animation Preview Logic
const previewCanvas = document.getElementById('previewCanvas');
let previewFrameIndex = 0;

function startPreviewAnimation() {
    if (!previewCanvas) return;

    // Set viewBox to match main canvas dimensions for auto-scaling
    // Main canvas is 800x600, preview is 400x300
    previewCanvas.setAttribute('viewBox', '0 0 800 600');

    function animate() {
        // Clear preview
        while (previewCanvas.firstChild) {
            previewCanvas.removeChild(previewCanvas.firstChild);
        }

        // Get paths for current preview frame
        // Ensure index is within bounds (in case MAX_FRAMES changes)
        if (previewFrameIndex >= MAX_FRAMES) previewFrameIndex = 0;

        const pathsToRender = frames[previewFrameIndex];

        if (pathsToRender) {
            pathsToRender.forEach(pathData => {
                // createPathElement creates a new DOM node, so it's safe.
                const el = createPathElement(pathData);
                previewCanvas.appendChild(el);
            });
        }

        // Increment frame
        previewFrameIndex = (previewFrameIndex + 1) % MAX_FRAMES;

        // Schedule next frame
        setTimeout(animate, frameDuration);
    }

    animate();
}

const fullscreenBtn = document.getElementById('fullscreenBtn');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
        if (previewCanvas.requestFullscreen) {
            previewCanvas.requestFullscreen();
        } else if (previewCanvas.webkitRequestFullscreen) { /* Safari */
            previewCanvas.webkitRequestFullscreen();
        } else if (previewCanvas.msRequestFullscreen) { /* IE11 */
            previewCanvas.msRequestFullscreen();
        }
    });
}

// Start the preview
startPreviewAnimation();
