// Cowork Session Archiver — viewer.js
// Comportements partagés entre l'aperçu de l'extension et transcript.html :
// visionneuse d'images, mode « infos complètes » / « lecture », affichage des événements techniques.
(function () {
  function setMode(mode) {
    const hr = mode === 'hr';
    document.body.classList.toggle('mode-hr', hr);
    // Blocs d'activité : dépliés en mode complet, repliés en mode lecture (seul l'affichage change)
    document.querySelectorAll('details.activity').forEach(d => { d.open = !hr; });
    const btn = document.getElementById('modeBtn');
    if (btn) { btn.textContent = hr ? 'Mode : lecture' : 'Mode : infos complètes'; btn.classList.toggle('on', !hr); btn.dataset.mode = mode; }
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
