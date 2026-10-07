// Cowork Session Archiver — viewer.js
// authors: 7hud41
// license: MIT
//
// Behaviours shared by the extension preview and the standalone transcript.html:
// image lightbox, "full details" / "reading" mode, display of technical events.
(function () {
  function modeLabel(hr) {
    const btn = document.getElementById('modeBtn');
    const fromData = btn && (hr ? btn.dataset.labelHr : btn.dataset.labelFull);
    if (fromData) return fromData;
    if (typeof t === 'function') return hr ? t('Mode: reading') : t('Mode: full details');
    return hr ? 'Mode: reading' : 'Mode: full details';
  }

  function setMode(mode) {
    const hr = mode === 'hr';
    document.body.classList.toggle('mode-hr', hr);
    // Activity blocks: expanded in full mode, collapsed in reading mode (display only, nothing is removed)
    document.querySelectorAll('details.activity').forEach(d => { d.open = !hr; });
    const btn = document.getElementById('modeBtn');
    if (btn) { btn.textContent = modeLabel(hr); btn.classList.toggle('on', !hr); btn.dataset.mode = mode; }
    try { localStorage.setItem('csa-mode', mode); } catch (_) {}
  }

  function ensureLightbox() {
    let lb = document.getElementById('lightbox');
    if (lb) return lb;
    lb = document.createElement('div'); lb.id = 'lightbox';
    const img = document.createElement('img');
    const cap = document.createElement('div'); cap.className = 'cap';
    lb.appendChild(img); lb.appendChild(cap);
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
    document.body.appendChild(lb);
    return lb;
  }

  function openImage(src, caption) {
    const lb = ensureLightbox();
    lb.querySelector('img').src = src;
    lb.querySelector('.cap').textContent = caption || '';
    lb.classList.add('open');
  }

  function init(defaultMode) {
    document.addEventListener('click', e => {
      const img = e.target.closest && e.target.closest('img.att');
      if (img) { e.preventDefault(); openImage(img.src, img.title); }
    });
    const btn = document.getElementById('modeBtn');
    if (btn) btn.addEventListener('click', () => setMode(btn.dataset.mode === 'hr' ? 'full' : 'hr'));
    const tech = document.getElementById('optTech');
    if (tech) tech.addEventListener('change', ev => document.body.classList.toggle('show-tech', ev.target.checked));
    setMode(defaultMode || 'full');
  }

  window.Viewer = { init, setMode, openImage };
})();
