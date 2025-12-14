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
                // Clone the element or create new one to avoid moving it from main canvas?
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

// Start the preview
startPreviewAnimation();
