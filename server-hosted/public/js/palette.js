// Limited palette support (max 8 colors), driven by central-server settings.
// Features:
//   - Swatches in the toolbar (#limitedPalette)
//   - Keys 1-8 select the matching palette color
//   - window.palette -> current array of hex colors (empty = unrestricted)
//   - Save options modal & color separation export when limited palette is active
(function () {
    const MAX_COLORS = 8;
    window.palette = [];

    function isTyping(e) {
        const t = e.target;
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }

    function selectColor(color) {
        brushColor = color;
        previousColor = color;
        if (typeof activeTool !== 'undefined' && activeTool === 'eraser') {
            activeTool = 'pencil';
            if (typeof updateToolButtons === 'function') updateToolButtons();
        }
        document.querySelectorAll('#limitedPalette .palette-swatch').forEach(s =>
            s.classList.toggle('active', s.dataset.color === color));
        document.querySelectorAll('.color-picker > .color-swatch').forEach(s => s.classList.remove('active'));
    }
    window.selectPaletteColor = (i) => { if (window.palette[i]) selectColor(window.palette[i]); };

    window.applyPalette = function (colors) {
        const list = Array.isArray(colors)
            ? colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_COLORS)
            : [];
        window.palette = list;

        const picker = document.querySelector('.color-picker');
        if (!picker) return;
        let box = document.getElementById('limitedPalette');
        if (!box) {
            box = document.createElement('div');
            box.id = 'limitedPalette';
            box.className = 'limited-palette';
            picker.appendChild(box);
        }
        box.innerHTML = '';

        // Free pickers are hidden whenever a limited palette is active
        picker.classList.toggle('palette-limited', list.length > 0);
        if (!list.length) return;

        list.forEach((color, i) => {
            const s = document.createElement('div');
            s.className = 'color-swatch palette-swatch';
            s.style.backgroundColor = color;
            s.dataset.color = color;
            s.title = `${color} (key ${i + 1})`;
            s.addEventListener('click', () => selectColor(color));
            box.appendChild(s);
        });

        // Keep current brush only if it's still allowed
        const current = String(brushColor).toLowerCase();
        selectColor(list.includes(current) ? current : list[0]);
    };

    document.addEventListener('keydown', (e) => {
        if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
        if (/^[1-8]$/.test(e.key)) window.selectPaletteColor(parseInt(e.key, 10) - 1);
    });

    // ==========================================
    // Save Options & Color Separation Export
    // ==========================================

    function normalizeColorHex(c) {
        if (!c || c === 'none' || c === 'transparent') return 'none';
        if (typeof colorToHex === 'function') {
            const hex = colorToHex(c).toLowerCase();
            if (/^#[0-9a-f]{3}$/i.test(hex)) {
                return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
            }
            return hex;
        }
        let s = String(c).trim().toLowerCase();
        if (!s.startsWith('#') && !s.startsWith('rgb')) s = '#' + s;
        if (/^#[0-9a-f]{3}$/i.test(s)) {
            return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
        }
        return s;
    }

    function pathMatchesPaletteColor(pathData, targetColor) {
        const targetNorm = normalizeColorHex(targetColor);
        let stroke = 'black';
        let fill = 'none';

        if (Array.isArray(pathData)) {
            stroke = pathData[1] || 'black';
            fill = pathData[4] || 'none';
        } else if (typeof pathData === 'object' && pathData !== null) {
            stroke = pathData.color || pathData.stroke || 'black';
            fill = pathData.fill || 'none';
        }

        const strokeNorm = normalizeColorHex(stroke);
        const fillNorm = normalizeColorHex(fill);

        return strokeNorm === targetNorm || fillNorm === targetNorm;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function createSimpleZip(files) {
        const crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
        function crc32(buf) {
            let crc = 0 ^ (-1);
            for (let i = 0; i < buf.length; i++) {
                crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
            }
            return (crc ^ (-1)) >>> 0;
        }

        const localHeaders = [];
        const encoder = new TextEncoder();
        let offset = 0;

        files.forEach(file => {
            const nameBytes = encoder.encode(file.filename);
            const dataBytes = encoder.encode(file.content);
            const fileCrc = crc32(dataBytes);
            const size = dataBytes.length;

            const header = new Uint8Array(30 + nameBytes.length);
            const view = new DataView(header.buffer);
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 10, true);
            view.setUint16(6, 0, true);
            view.setUint16(8, 0, true);
            view.setUint16(10, 0, true);
            view.setUint16(12, 0, true);
            view.setUint32(14, fileCrc, true);
            view.setUint32(18, size, true);
            view.setUint32(22, size, true);
            view.setUint16(26, nameBytes.length, true);
            view.setUint16(28, 0, true);
            header.set(nameBytes, 30);

            localHeaders.push({ header, data: dataBytes, nameBytes, fileCrc, size, offset });
            offset += header.length + size;
        });

        const centralHeaders = [];
        let centralDirSize = 0;

        localHeaders.forEach(entry => {
            const cHeader = new Uint8Array(46 + entry.nameBytes.length);
            const view = new DataView(cHeader.buffer);
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 10, true);
            view.setUint16(8, 0, true);
            view.setUint16(10, 0, true);
            view.setUint16(12, 0, true);
            view.setUint16(14, 0, true);
            view.setUint32(16, entry.fileCrc, true);
            view.setUint32(20, entry.size, true);
            view.setUint32(24, entry.size, true);
            view.setUint16(28, entry.nameBytes.length, true);
            view.setUint16(30, 0, true);
            view.setUint16(32, 0, true);
            view.setUint16(34, 0, true);
            view.setUint16(36, 0, true);
            view.setUint32(38, 0, true);
            view.setUint32(42, entry.offset, true);
            cHeader.set(entry.nameBytes, 46);

            centralHeaders.push(cHeader);
            centralDirSize += cHeader.length;
        });

        const eocd = new Uint8Array(22);
        const eocdView = new DataView(eocd.buffer);
        eocdView.setUint32(0, 0x06054b50, true);
        eocdView.setUint16(4, 0, true);
        eocdView.setUint16(6, 0, true);
        eocdView.setUint16(8, files.length, true);
        eocdView.setUint16(10, files.length, true);
        eocdView.setUint32(12, centralDirSize, true);
        eocdView.setUint32(16, offset, true);
        eocdView.setUint16(20, 0, true);

        const totalLen = offset + centralDirSize + 22;
        const out = new Uint8Array(totalLen);
        let p = 0;
        localHeaders.forEach(e => {
            out.set(e.header, p); p += e.header.length;
            out.set(e.data, p); p += e.data.length;
        });
        centralHeaders.forEach(ch => {
            out.set(ch, p); p += ch.length;
        });
        out.set(eocd, p);
        return new Blob([out], { type: 'application/zip' });
    }

    function getSeparationData() {
        if (!window.palette || window.palette.length === 0) return [];
        const canvasEl = document.getElementById('canvas');
        const w = (canvasEl && canvasEl.getAttribute('width')) || 800;
        const h = (canvasEl && canvasEl.getAttribute('height')) || 600;
        const currentPaths = window.paths || [];

        return window.palette.map((color, index) => {
            const matchingPaths = currentPaths.filter(p => pathMatchesPaletteColor(p, color));
            const svgContent = (typeof generateFormattedSVG === 'function')
                ? generateFormattedSVG(matchingPaths, w, h)
                : '';
            const cleanHex = color.replace('#', '').toLowerCase();
            const filename = `drawing-color-${index + 1}-${cleanHex}.svg`;
            return {
                index: index + 1,
                color,
                filename,
                svgContent,
                pathCount: matchingPaths.length
            };
        });
    }

    function createSaveModalDOM() {
        let modal = document.getElementById('saveModal');
        if (modal) return modal;

        modal = document.createElement('dialog');
        modal.id = 'saveModal';
        modal.className = 'save-modal';
        modal.setAttribute('aria-labelledby', 'saveModalTitle');

        modal.innerHTML = `
            <div class="save-modal-header">
                <h3 id="saveModalTitle"><i class="ph ph-floppy-disk"></i> Save Options</h3>
                <button type="button" class="save-modal-close" id="saveModalClose" aria-label="Close">&times;</button>
            </div>
            <div class="save-modal-body">
                <div class="save-option-card">
                    <div class="save-option-title">Whole Image</div>
                    <div class="save-option-desc">Export the entire artwork with all colors in a single SVG file.</div>
                    <div>
                        <button type="button" class="save-btn-primary" id="saveWholeImageBtn">
                            <i class="ph ph-image"></i> Save Whole Image (SVG)
                        </button>
                    </div>
                </div>

                <div class="save-option-card">
                    <div class="save-option-title" id="sepCardTitle">Color Separations</div>
                    <div class="save-option-desc">
                        Export separated SVG layers for all predefined palette colors.
                    </div>
                    <div class="separations-list" id="separationsList"></div>
                    <div class="save-actions-row">
                        <button type="button" class="save-btn-primary" id="saveAllZipBtn">
                            <i class="ph ph-archive"></i> Download All (.zip)
                        </button>
                        <button type="button" class="save-btn-secondary" id="saveAllSvgBtn">
                            <i class="ph ph-download-simple"></i> Download All (.svg files)
                        </button>
                    </div>
                </div>
            </div>
            <div class="save-modal-footer">
                <button type="button" class="save-btn-secondary" id="saveModalCancelBtn">Cancel</button>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.close();
        });

        modal.querySelector('#saveModalClose').addEventListener('click', () => modal.close());
        modal.querySelector('#saveModalCancelBtn').addEventListener('click', () => modal.close());

        modal.querySelector('#saveWholeImageBtn').addEventListener('click', () => {
            modal.close();
            if (typeof window.exportSVG === 'function') {
                window.exportSVG(true);
            }
        });

        modal.querySelector('#saveAllZipBtn').addEventListener('click', () => {
            const seps = getSeparationData();
            if (!seps || seps.length === 0) return;
            modal.close();
            const zipBlob = createSimpleZip(seps.map(s => ({ filename: s.filename, content: s.svgContent })));
            downloadBlob(zipBlob, 'drawing-color-separations.zip');
        });

        modal.querySelector('#saveAllSvgBtn').addEventListener('click', () => {
            const seps = getSeparationData();
            if (!seps || seps.length === 0) return;
            modal.close();
            seps.forEach((s, i) => {
                setTimeout(() => {
                    const blob = new Blob([s.svgContent], { type: 'image/svg+xml' });
                    downloadBlob(blob, s.filename);
                }, i * 200);
            });
        });

        return modal;
    }

    function showSaveModal() {
        if (!window.palette || window.palette.length === 0) {
            if (typeof window.exportSVG === 'function') window.exportSVG(true);
            return;
        }
        const modal = createSaveModalDOM();
        const seps = getSeparationData();

        const titleEl = modal.querySelector('#sepCardTitle');
        if (titleEl) {
            titleEl.textContent = `Color Separations (${seps.length} Colors)`;
        }

        const listEl = modal.querySelector('#separationsList');
        if (listEl) {
            listEl.innerHTML = '';
            seps.forEach(s => {
                const row = document.createElement('div');
                row.className = 'separation-item';

                const info = document.createElement('div');
                info.className = 'separation-item-info';

                const swatch = document.createElement('div');
                swatch.className = 'separation-swatch';
                swatch.style.backgroundColor = s.color;

                const label = document.createElement('span');
                label.className = 'separation-label';
                label.textContent = `Color ${s.index} • ${s.color.toUpperCase()}`;

                const count = document.createElement('span');
                count.className = 'separation-count';
                count.textContent = `(${s.pathCount} ${s.pathCount === 1 ? 'path' : 'paths'})`;

                info.appendChild(swatch);
                info.appendChild(label);
                info.appendChild(count);

                const dlBtn = document.createElement('button');
                dlBtn.type = 'button';
                dlBtn.className = 'separation-btn-single';
                dlBtn.title = `Download ${s.filename}`;
                dlBtn.innerHTML = '<i class="ph ph-download-simple"></i> SVG';
                dlBtn.addEventListener('click', () => {
                    const blob = new Blob([s.svgContent], { type: 'image/svg+xml' });
                    downloadBlob(blob, s.filename);
                });

                row.appendChild(info);
                row.appendChild(dlBtn);
                listEl.appendChild(row);
            });
        }

        modal.showModal();
    }
    window.showSaveModal = showSaveModal;
})();
