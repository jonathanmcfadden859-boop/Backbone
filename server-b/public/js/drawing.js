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

ws.onopen = () => {
    console.log('Connected to server WebSocket');
};

ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.type === 'drawing_update' && Array.isArray(data.paths)) {
            // Determine target frame (default to 0 if missing, for backward compatibility)
            const targetFrameIndex = (typeof data.frameIndex === 'number') ? data.frameIndex : 0;

            // Validate index range
            if (targetFrameIndex >= 0 && targetFrameIndex < MAX_FRAMES) {
                // Append paths to the correct frame
                data.paths.forEach(p => frames[targetFrameIndex].push(p));

                // If we are currently viewing this frame, re-render immediately
                if (targetFrameIndex === currentFrameIndex) {
                    // Update tracking if we are on the same frame? 
                    // Actually lastTransmittedIndex tracks OUR sending. 
                    // Incoming paths don't change what we need to send, 
                    // but they DO increase the total count.
                    // If we blindly add, our 'lastTransmittedIndex' might get out of sync 
                    // if it was simply "length of array".
                    // But 'transmitDrawing' slices from 'lastTransmittedIndex'.
                    // If we just added incoming paths to the end, 'transmitDrawing' would 
                    // think these match new local paths and try to send them back?
                    // NO. 'lastTransmittedIndex' is updated to 'paths.length' AFTER send.
                    // If we receive paths, 'paths.length' increases.
                    // If we draw again, we slice from OLD 'lastTransmittedIndex'. 
                    // This includes the RECEIVED paths.
                    // result: We ECHO back the paths we just got. This is bad.

                    // FIX: When receiving paths, we must assume they are "synced" 
                    // and bump 'lastTransmittedIndex' locally so we don't re-transmit them.
                    lastTransmittedIndex += data.paths.length;

                    renderPaths();
                    updateButtons();
                    if (showSVG && svgOutput) updateSVGOutput();
                } else {
                    // If we received data for a different frame, maybe show a visual indicator?
                    // For now, just store it.
                    // Note: We do NOT update 'lastTransmittedIndex' for the currently hidden frame 
                    // because 'lastTransmittedIndex' is a global variable currently tracking the active frame only?
                    // WAIT. 'lastTransmittedIndex' is global in this file.
                    // In 'switchFrame', we reset `lastTransmittedIndex = frames[currentFrameIndex].length;`
                    // So if we receive data for a HIDDEN frame, we just push it.
                    // When the user eventually switches to that frame, 'switchFrame' will run:
                    // `lastTransmittedIndex = frames[newIndex].length`
                    // This sets it to the full length (including these received paths).
                    // So we won't re-transmit them. This works perfectly!
                }
            }
        } else if (data.type === 'settings_update' && data.settings) {
            console.log('Received session settings update:', data.settings);
            applySessionSettings(data.settings);
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
    let path = `M ${simplified[0].x} ${simplified[0].y}`;
    if (simplified.length === 2) {
        path += ` L ${simplified[1].x} ${simplified[1].y}`;
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
            path += ` Q ${p1.x} ${p1.y} ${(p1.x + cp2x) / 2} ${(p1.y + cp2y) / 2}`;
        } else {
            path += ` C ${cp1x} ${cp1y} ${p1.x} ${p1.y} ${(p1.x + cp2x) / 2} ${(p1.y + cp2y) / 2}`;
        }
    }
    const lastPoint = simplified[simplified.length - 1];
    const secondLast = simplified[simplified.length - 2];
    path += ` Q ${secondLast.x} ${secondLast.y} ${lastPoint.x} ${lastPoint.y}`;
    return path;
}

// Create SVG path element
// pathData can be a string (legacy) or an object { d, color, width, opacity }
function createPathElement(pathData, isTemp = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    let d = '';
    let color = brushColor;
    let width = brushSize;
    let opacity = brushOpacity;

    if (typeof pathData === 'string') {
        d = pathData;
        // Defaults for legacy paths
        color = 'black';
        width = 2;
        opacity = 1;
    } else {
        d = pathData.d;
        color = pathData.color || 'black';
        width = pathData.width || 2;
        opacity = pathData.opacity !== undefined ? pathData.opacity : 1;
    }

    if (isTemp) {
        // Use current brush settings for temp path
        color = brushColor;
        width = brushSize;
        opacity = brushOpacity;
    }

    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', width);
    path.setAttribute('fill', 'none');
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
        const d = typeof path === 'string' ? path : path.d;
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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    currentPath = [{ x, y }];
}

function draw(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    currentPath.push({ x, y });
    renderPaths();
}

function stopDrawing() {
    if (isDrawing && currentPath.length > 1) {
        const bezierPath = pointsToBezier(currentPath);

        // Save path with current style
        paths.push({
            d: bezierPath,
            color: brushColor,
            width: brushSize,
            opacity: brushOpacity
        });

        updateButtons();
        if (showSVG) updateSVGOutput();

        // Auto-transmit the new stroke if Live mode is on
        if (isLive) {
            transmitDrawing();
        }
    }
    isDrawing = false;
    currentPath = [];
    renderPaths();
}

function clearDrawing() {
    paths = [];
    currentPath = [];
    lastTransmittedIndex = 0;
    renderPaths();
    updateButtons();
    if (showSVG) updateSVGOutput();
}

function transmitDrawing() {
    if (paths.length > lastTransmittedIndex) {
        const newPaths = paths.slice(lastTransmittedIndex);
        const message = {
            type: 'drawing_update',
            frameIndex: currentFrameIndex,
            paths: newPaths
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
            if (activeTool === 'pencil') {
                brushColor = styleColor;
                previousColor = styleColor;
            } else {
                // If erasing and user picks a color, switch back to pencil
                activeTool = 'pencil';
                brushColor = styleColor;
                previousColor = styleColor;
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
    activeTool = 'pencil'; // Switch to pencil when picking color
    brushColor = pickedColor;
    previousColor = pickedColor;
    updateToolButtons();
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

    const statusTool = document.querySelector('.status-item-tool');
    if (statusTool) {
        statusTool.textContent = `Tool: ${activeTool.charAt(0).toUpperCase() + activeTool.slice(1)}`;
    }
}

if (toolBtns) {
    toolBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const title = btn.getAttribute('title').toLowerCase();

            if (title === 'pencil') {
                activeTool = 'pencil';
                brushColor = previousColor;
                // If previous color was white (e.g. manually picked), might be confusing, but correct logic
                if (brushColor === 'white' || brushColor === '#ffffff' || brushColor === 'rgb(255, 255, 255)') {
                    // Maybe default to black if they switch to pencil and history was white? 
                    // Let's leave it simple for now.
                }
            } else if (title === 'eraser') {
                activeTool = 'eraser';
                previousColor = brushColor; // Save current drawing color
                // Simulate boolean subtract by painting with the canvas background color
                // This is the standard performant way to "erase" in vector-over-raster engines 
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
