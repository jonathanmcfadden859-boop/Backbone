// Limited palette support (max 8 colors), driven by central-server settings.
// Easy access:
//   - Swatches in the toolbar (#limitedPalette)
//   - Keys 1-8 select the matching palette color
//   - window.palette -> current array of hex colors (empty = unrestricted)
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
})();
