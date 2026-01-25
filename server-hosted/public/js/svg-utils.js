/**
 * SVG Utilities for Drawing Application
 */

/**
 * Simplifies a set of points using the Ramer-Douglas-Peucker algorithm
 */
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

/**
 * Converts an array of points to a smooth Bezier SVG path string
 */
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

/**
 * Creates an SVG path element from path data
 * @param {Array|String|Object} pathData - The path data ([d, color, size, opacity, fill], or "d", or {d, color, size, opacity, fill})
 * @param {Object} context - Optional current brush/tool state to fall back to if data is missing or if it's a temp path
 */
function createPathElement(pathData, context = {}) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    let d = '';
    let color = context.brushColor || 'black';
    let width = context.brushSize || 2;
    let opacity = context.brushOpacity !== undefined ? context.brushOpacity : 1;
    let fill = 'none';

    if (Array.isArray(pathData)) {
        // [d, color, width, opacity, fill]
        d = pathData[0];
        color = pathData[1] || color;
        width = pathData[2] || width;
        opacity = pathData[3] !== undefined ? pathData[3] : opacity;
        fill = pathData[4] || fill;
    } else if (typeof pathData === 'string') {
        d = pathData;
    } else {
        d = pathData.d;
        color = pathData.color || color;
        width = pathData.width || width;
        opacity = pathData.opacity !== undefined ? pathData.opacity : opacity;
        fill = pathData.fill || fill;
    }

    if (context.isTemp) {
        color = context.brushColor;
        width = context.brushSize;
        opacity = context.brushOpacity;
        if (context.activeTool !== 'pencil') {
            fill = context.brushColor;
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

/**
 * Converts any color string (name, rgb, hsl) to a hex code
 */
function colorToHex(color) {
    if (!color || color === 'none') return 'none';
    if (color.startsWith('#')) return color;

    // Create a temporary element to let the browser parse the color
    const div = document.createElement('div');
    div.style.color = color;
    document.body.appendChild(div);
    const resolved = window.getComputedStyle(div).color;
    document.body.removeChild(div);

    // Resolved will be in "rgb(r, g, b)" or "rgba(r, g, b, a)" format
    const match = resolved.match(/\d+/g);
    if (!match || match.length < 3) return '#000000';

    const r = parseInt(match[0]);
    const g = parseInt(match[1]);
    const b = parseInt(match[2]);

    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * Generates a formatted SVG string according to a specific Adobe Illustrator-like structure
 * @param {Array} paths - Array of path objects or arrays
 * @param {Number} width - Canvas width
 * @param {Number} height - Canvas height
 * @returns {String} Formatted SVG string
 */
function generateFormattedSVG(paths, width, height) {
    const styleMap = new Map();
    let classCounter = 0;

    const getProperties = (pathData) => {
        let d = '', color = 'black', strokeWidth = 2, opacity = 1, fill = 'none';
        if (Array.isArray(pathData)) {
            d = pathData[0];
            color = pathData[1] || 'black';
            strokeWidth = pathData[2] || 2;
            opacity = pathData[3] !== undefined ? pathData[3] : 1;
            fill = pathData[4] || 'none';
        } else if (typeof pathData === 'string') {
            d = pathData;
        } else {
            d = pathData.d;
            color = pathData.color || 'black';
            strokeWidth = pathData.width || 2;
            opacity = pathData.opacity !== undefined ? pathData.opacity : 1;
            fill = pathData.fill || 'none';
        }
        return {
            d,
            color: colorToHex(color),
            strokeWidth,
            opacity,
            fill: colorToHex(fill)
        };
    };

    const pathInfos = paths.map(p => {
        const props = getProperties(p);
        const styleKey = JSON.stringify({
            color: props.color,
            width: props.strokeWidth,
            opacity: props.opacity,
            fill: props.fill
        });

        if (!styleMap.has(styleKey)) {
            styleMap.set(styleKey, `st${classCounter++}`);
        }
        return { d: props.d, className: styleMap.get(styleKey), props };
    });

    let styleContent = '';
    styleMap.forEach((className, key) => {
        const props = JSON.parse(key);
        styleContent += `      .${className} {\n`;
        if (props.color && props.color !== 'none') styleContent += `        stroke: ${props.color};\n`;
        if (props.width) styleContent += `        stroke-width: ${props.width}px;\n`;
        if (props.opacity !== 1) {
            styleContent += `        isolation: isolate;\n`;
            styleContent += `        opacity: ${props.opacity};\n`;
        }
        styleContent += `        fill: ${props.fill || 'none'};\n`;
        styleContent += `        stroke-linecap: round;\n`;
        styleContent += `        stroke-linejoin: round;\n`;
        styleContent += `        stroke-miterlimit: 10;\n`;
        styleContent += `      }\n\n`;
    });

    const pathStrings = pathInfos.map(info => {
        return `  <path class="${info.className}" d="${info.d}"/>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg id="canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${width} ${height}">
  <!-- Generator: Adobe Illustrator 29.8.4, SVG Export Plug-In . SVG Version: 2.1.1 Build 6)  -->
  <defs>
    <style>
${styleContent}    </style>
  </defs>
${pathStrings}
</svg>`;
}
