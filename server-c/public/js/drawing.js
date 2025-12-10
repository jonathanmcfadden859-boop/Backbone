// State
let paths = [];
let currentPath = [];
let isDrawing = false;
let showSVG = false;
let lastTransmittedIndex = 0;

// DOM elements
const canvas = document.getElementById('canvas');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const copyBtn = document.getElementById('copyBtn');
const transmitBtn = document.getElementById('transmitBtn');
const toggleBtn = document.getElementById('toggleBtn');
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
            // Append new paths
            data.paths.forEach(p => paths.push(p));
            // Update last transmitted index so we don't re-transmit what we just received?
            // Actually, lastTransmittedIndex tracks what WE sent. 
            // If we receive paths, they are now part of our canvas. 
            // We should increase lastTransmittedIndex so we don't send them back?
            // The prompt says "only the last set of changes drawn by the user".
            // So we should only transmit paths that originated from THIS user interaction.
            // But 'paths' array now mixes local vs remote paths.
            // A better way is to tag paths or keep local index separate.
            // However, simplicity: lastTransmittedIndex tracks the *total* count.
            // If we receive remote paths, we push them. If we hit transmit, we send from lastTransmittedIndex to end.
            // Do we want to re-broadcast what we received? Probably not.
            // But if we are just a client, we send what is "new" on our canvas.
            // If we received it, it's not "drawn by the user".
            // So we need to track which paths are OURS vs remote if we want to be strict.
            // OR simpler: 'lastTransmittedIndex' matches 'paths.length'. 
            // When we receive remote paths, we increment lastTransmittedIndex too.
            // This prevents re-sending them.

            lastTransmittedIndex += data.paths.length;
            renderPaths();
            updateButtons();
            if (showSVG) updateSVGOutput();
        }
    } catch (e) {
        // console.log('Received non-drawing message', event.data);
    }
};

// ... (simplifyPoints, pointsToBezier, createPathElement, renderPaths - reuse as is) ...

// Simplify points using Ramer-Douglas-Peucker algorithm
function simplifyPoints(points, tolerance = 2) {
    if (points.length < 3) return points;

    const sqTolerance = tolerance * tolerance;

    const getSqDist = (p1, p2) => {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return dx * dx + dy * dy;
    };

    const getSqSegDist = (p, p1, p2) => {
        let x = p1.x, y = p1.y;
        let dx = p2.x - x, dy = p2.y - y;

        if (dx !== 0 || dy !== 0) {
            const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = p2.x;
                y = p2.y;
            } else if (t > 0) {
                x += dx * t;
                y += dy * t;
            }
        }

        dx = p.x - x;
        dy = p.y - y;
        return dx * dx + dy * dy;
    };

    const simplifyDPStep = (points, first, last, sqTolerance, simplified) => {
        let maxSqDist = sqTolerance;
        let index = 0;

        for (let i = first + 1; i < last; i++) {
            const sqDist = getSqSegDist(points[i], points[first], points[last]);
            if (sqDist > maxSqDist) {
                index = i;
                maxSqDist = sqDist;
            }
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

    // Use cubic Bezier curves for smooth paths
    for (let i = 1; i < simplified.length - 1; i++) {
        const p0 = simplified[i - 1];
        const p1 = simplified[i];
        const p2 = simplified[i + 1];

        // Calculate control points for smooth curve
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
function createPathElement(pathData, isTemp = false) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', isTemp ? 'blue' : 'black');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if (isTemp) path.setAttribute('opacity', '0.7');
    return path;
}

// Render all paths
function renderPaths() {
    // Clear canvas except for namespace attributes
    while (canvas.firstChild) {
        canvas.removeChild(canvas.firstChild);
    }

    // Draw all completed paths
    paths.forEach(pathData => {
        canvas.appendChild(createPathElement(pathData));
    });

    // Draw current path if drawing
    if (isDrawing && currentPath.length > 1) {
        const bezierPath = pointsToBezier(currentPath);
        canvas.appendChild(createPathElement(bezierPath, true));
    }
}

// Update SVG output display
function updateSVGOutput() {
    pathList.innerHTML = '';
    paths.forEach((path, index) => {
        const pathItem = document.createElement('div');
        pathItem.className = 'path-item';
        pathItem.innerHTML = `
            <div class="path-label">Path ${index + 1}:</div>
            <div>d="${path}"</div>
        `;
        pathList.appendChild(pathItem);
    });
}

// Update button states
function updateButtons() {
    const hasContent = paths.length > 0;
    exportBtn.disabled = !hasContent;
    copyBtn.disabled = !hasContent;

    // Enable transmit if we have NEW content
    transmitBtn.disabled = paths.length === lastTransmittedIndex;
}

// Event handlers
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
        paths.push(bezierPath);
        updateButtons();
        if (showSVG) updateSVGOutput();
    }
    isDrawing = false;
    currentPath = [];
    renderPaths();
}

function clearDrawing() {
    paths = [];
    currentPath = [];
    lastTransmittedIndex = 0; // Reset tracking
    renderPaths();
    updateButtons();
    if (showSVG) updateSVGOutput();
}

function transmitDrawing() {
    if (paths.length > lastTransmittedIndex) {
        const newPaths = paths.slice(lastTransmittedIndex);

        // Construct message
        const message = {
            type: 'drawing_update',
            paths: newPaths
        };

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            lastTransmittedIndex = paths.length; // Mark as sent
            updateButtons();
            alert('Broadcasting ' + newPaths.length + ' new path(s)...');
        } else {
            alert('WebSocket not connected.');
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
    const pathStrings = paths.map((path, i) =>
        `  <path d="${path}" stroke="black" stroke-width="2" fill="none" />`
    ).join('\n');

    const svgCode = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">\n${pathStrings}\n</svg>`;

    navigator.clipboard.writeText(svgCode).then(() => {
        alert('SVG code copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy SVG code');
    });
}

function toggleSVGDisplay() {
    showSVG = !showSVG;
    svgOutput.classList.toggle('hidden', !showSVG);
    toggleBtn.textContent = showSVG ? 'Hide SVG Paths' : 'Show SVG Paths';
    if (showSVG) updateSVGOutput();
}

// Attach event listeners
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

clearBtn.addEventListener('click', clearDrawing);
exportBtn.addEventListener('click', exportSVG);
copyBtn.addEventListener('click', copySVGCode);
transmitBtn.addEventListener('click', transmitDrawing);
toggleBtn.addEventListener('click', toggleSVGDisplay);

// Initial render
renderPaths();
