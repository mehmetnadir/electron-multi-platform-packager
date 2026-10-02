// Flashy Design System — ortak JS
// Tema modülleri FlashyUI üzerinden component'lere erişir.
window.FlashyUI = (() => {
  // ── Card grid render ─────────────────────────
  function renderCardGrid(containerId, items, onClick) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = items.map((it, i) => {
      const coverFirst = !!it.cover;
      return `
      <article class="flashy-card ${coverFirst ? 'flashy-card--cover-first' : ''} reveal"
               style="--c1:${it.c1};--c2:${it.c2}; animation-delay:${i * 70}ms" data-id="${it.id}">
        <div class="fc-inner">
          ${it.cover
            ? `<div class="fc-cover"><img src="${it.cover}" alt="${it.title}" onerror="this.parentNode.innerHTML='<span class=&quot;fc-emoji&quot;>${it.emoji || '📘'}</span>'"/></div>`
            : ''}
          <span class="fc-badge">${it.badge || 'BOOK'}${it.emoji ? ` <span aria-hidden="true" style="margin-left:4px">${it.emoji}</span>` : ''}</span>
          ${it.num ? `<div class="fc-num">${it.num}</div>` : ''}
          <h3 class="fc-title">${it.title}</h3>
          <p class="fc-sub">${it.sub || ''}</p>
        </div>
        <div class="fc-arrow"><i class="fa-solid fa-arrow-right"></i></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('.flashy-card').forEach(card => {
      card.addEventListener('click', () => onClick(card.dataset.id, items.find(x => String(x.id) === card.dataset.id)));
    });
  }

  // ── Scroll reveal ────────────────────────────
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    document.querySelectorAll('.hero *, .section-title, .feature').forEach((el, i) => {
      el.classList.add('reveal');
      setTimeout(() => el.classList.add('in'), 80 + i * 50);
      io.observe(el);
    });
  }

  // ── Loader ───────────────────────────────────
  const Loader = {
    show(title) {
      const el = document.getElementById('loader');
      const t = document.getElementById('loaderTitle');
      if (t && title) t.textContent = title;
      if (el) el.hidden = false;
      this.set(0, '');
    },
    hide() {
      const el = document.getElementById('loader');
      if (el) el.hidden = true;
    },
    set(pct, meta) {
      const fill = document.getElementById('loaderFill');
      const m = document.getElementById('loaderMeta');
      if (fill) fill.style.width = pct + '%';
      if (m && meta != null) m.textContent = meta;
    },
  };

  // ── Unit modal ───────────────────────────────
  const Modal = {
    open({ title, subtitle, cover, c1, c2, units, onUnit }) {
      let ov = document.getElementById('unitModal');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'unitModal';
        ov.className = 'modal-overlay';
        ov.hidden = true;
        document.body.appendChild(ov);
      }
      ov.style.setProperty('--c1', c1 || 'var(--brand)');
      ov.style.setProperty('--c2', c2 || 'var(--brand-2)');
      ov.innerHTML = `
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-cover">${cover || '<i class="fa-solid fa-book-open"></i>'}</div>
            <div class="modal-title">
              <h3>${title}</h3>
              <p>${subtitle || ''}</p>
            </div>
            <button class="modal-close" aria-label="Kapat"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            ${units.length === 0
              ? `<p style="text-align:center;color:var(--ink-soft);padding:32px">Ünite bulunamadı.</p>`
              : units.map((u, i) => `
                <div class="unit-item" data-idx="${i}">
                  <div class="unit-num">${u.num || (i + 1)}</div>
                  <div class="unit-label">${u.label}</div>
                  <div class="unit-page">${u.page ? 'Sayfa ' + u.page : ''}</div>
                </div>
              `).join('')}
          </div>
        </div>
      `;
      ov.hidden = false;
      ov.querySelector('.modal-close').onclick = () => { ov.hidden = true; };
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
      ov.querySelectorAll('.unit-item').forEach(el => {
        el.onclick = () => onUnit && onUnit(units[+el.dataset.idx]);
      });
    },
    close() {
      const ov = document.getElementById('unitModal');
      if (ov) ov.hidden = true;
    },
  };

  // ── Language toggle ──────────────────────────
  function initLang(i18n) {
    let lang = localStorage.getItem('flashy-lang') || 'TR';
    const apply = () => {
      const lbl = document.getElementById('langLabel');
      if (lbl) lbl.textContent = lang;
      const data = i18n[lang] || {};
      for (const [key, val] of Object.entries(data)) {
        const el = document.querySelector(`[data-i18n="${key}"]`);
        if (el) el.textContent = val;
      }
    };
    const btn = document.getElementById('langBtn');
    if (btn) btn.onclick = () => {
      lang = lang === 'TR' ? 'EN' : 'TR';
      localStorage.setItem('flashy-lang', lang);
      apply();
    };
    apply();
  }

  return { renderCardGrid, initReveal, Loader, Modal, initLang };
})();
