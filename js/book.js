// Lector del libro: paginación, paso de página y audio sincronizado con los splats.
import { createView, destroyView, setVisible, pointer, supported } from './splats.js';
import { CONFIG, buyHref } from './config.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const COVER_SPLATS = 'assets/splats/oda-al-girasol-feliz.bin';
const FLIP_MS = 1000;

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const fmt = s => (!isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

function unitsOf(text) {
  const units = [];
  text.split(/\n\s*\n/).forEach((st, k) => {
    if (k) units.push({ t: 'br' });
    st.split('\n').map(s => s.trim()).filter(Boolean)
      .forEach(s => units.push({ t: 'ln', s, prose: s.length > 95 }));
  });
  return units;
}

export class Reader {
  constructor(root, data) {
    this.root = root;
    this.data = data;
    this.poems = data.poems;
    this.stage = root.querySelector('#stage');
    this.bookEl = root.querySelector('#book');
    this.pages = [];
    this.pos = 0;              // desktop: hojas volteadas · móvil: página actual
    this.mode = null;
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.audioPoem = -1;
    this.saved = this.poems.map(() => ({ t: 0, ratio: 0 }));
    this.continueNext = false;
    this.busyUntil = 0;
    this.initPlayer();
    this.initInput();
    this.loadPoem(-1, false);
    window.addEventListener('resize', () => {
      if (this.root.hidden) return;
      clearTimeout(this._rt);
      this._rt = setTimeout(() => this.build(), 220);
    });
  }

  // ------------------------------------------------------------- abrir/cerrar
  open(slug) {
    const first = this.root.hidden;
    this.root.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => this.root.classList.add('show'));
    if (first || !this.pages.length) this.build();
    const idx = slug ? this.poems.findIndex(p => p.slug === slug) : -1;
    if (idx >= 0) this.goToPoem(idx, first);
    else if (first) this.goTo(0, true);
    this.refreshVisible();
  }

  close() {
    this.audio.pause();
    this.root.classList.remove('show');
    setTimeout(() => {
      this.root.hidden = true;
      document.body.style.overflow = '';
      this.pages.forEach(p => p.view && setVisible(p.view, false));
    }, 450);
  }

  // ------------------------------------------------------------- construcción
  measure() {
    const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    const desktop = sw >= 720 && sw > sh * 1.12;
    let pw, ph;
    if (desktop) {
      const availW = sw - 120, availH = sh - 24;
      pw = Math.floor(Math.min(availW / 2, availH * 0.75));
      ph = Math.floor(pw * 4 / 3);
    } else {
      const availW = sw - 24, availH = sh - 16;
      pw = Math.floor(Math.min(availW, 560, availH / 1.2));
      ph = Math.floor(Math.min(availH, pw * 1.72));
    }
    return { mode: desktop ? 'spread' : 'single', pw, ph };
  }

  build() {
    const anchor = this.anchor();
    this.pages.forEach(p => p.view && destroyView(p.view));
    this.pages = [];
    const { mode, pw, ph } = this.measure();
    this.mode = mode; this.pw = pw; this.ph = ph;
    const book = this.bookEl;
    book.innerHTML = '';
    book.className = 'book ' + mode;
    book.style.width = (mode === 'spread' ? pw * 2 : pw) + 'px';
    book.style.height = ph + 'px';
    book.style.setProperty('--pw', pw + 'px');

    // contenedor de medición con el tamaño exacto de una página
    const meas = el('div');
    meas.style.cssText = `position:absolute;left:-9999px;top:0;width:${pw}px;height:${ph}px;visibility:hidden`;
    meas.style.setProperty('--pw', pw + 'px');
    this.stage.appendChild(meas);
    this.meas = meas;

    this.pages.push(this.coverPage());
    this.pages.push(this.epigraphPage());
    const indexPage = this.indexPage();
    this.pages.push(indexPage);
    this.poemStart = [];
    this.poems.forEach((poem, k) => {
      this.poemStart[k] = this.pages.length;
      const pages = mode === 'spread' ? this.paginateSpread(poem, k) : this.paginateSingle(poem, k);
      this.pages.push(...pages);
    });
    if (mode === 'spread' && this.pages.length % 2 === 0) this.pages.push(this.blankPage());
    this.pages.push(this.endPage());
    this.pages.forEach((p, i) => {
      if (p.poem != null) p.el.appendChild(el('div', 'folio', String(i)));
    });
    this.fillIndex(indexPage);
    meas.remove();

    if (mode === 'spread') this.mountSpread(); else this.mountSingle();
    this.restore(anchor);
  }

  newPage(cls) {
    const page = el('div', 'page ' + (cls || ''));
    page.style.setProperty('--pw', this.pw + 'px');
    page.appendChild(el('div', 'inner'));
    return page;
  }

  coverPage() {
    const page = this.newPage('p-cover');
    page.insertAdjacentHTML('beforeend', `
      <span class="cover-title" style="z-index:3">El girasol<br><em>que cobró consciencia de sol</em></span>
      <span class="cover-author" style="z-index:3">El escritor de odas</span>
      <span class="tap">abrir</span>`);
    const base = el('img', 'cover-base');
    base.src = 'assets/img/oda-al-girasol-feliz.jpg'; base.alt = '';
    page.appendChild(base);
    const p = { el: page, kind: 'cover' };
    this.addArt(p, COVER_SPLATS, () => {
      const w = this.pw * 0.74;
      return { x: this.pw * 0.13, y: this.ph - w * 4 / 3 - this.pw * 0.01, w };
    }, { cover: true });
    return p;
  }

  epigraphPage() {
    const page = this.newPage('p-epigraph');
    page.querySelector('.inner').innerHTML = `
      <blockquote>Nadie me dijo<br>que los girasoles<br>lloraban amarillo.</blockquote>
      <cite>Oda al girasol triste</cite>`;
    return { el: page, kind: 'epigraph' };
  }

  indexPage() {
    const page = this.newPage('p-index');
    page.querySelector('.inner').innerHTML = `<h2>Índice</h2><ol></ol>`;
    return { el: page, kind: 'index' };
  }

  fillIndex(p) {
    const ol = p.el.querySelector('ol');
    this.poems.forEach((poem, k) => {
      const li = el('li');
      const b = el('button', null, `<span>${poem.title}</span><span class="dots"></span><span>${this.poemStart[k]}</span>`);
      b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); this.goToPoem(k); });
      li.appendChild(b);
      ol.appendChild(li);
    });
  }

  blankPage() { return { el: this.newPage('p-blank'), kind: 'blank' }; }

  endPage() {
    const page = this.newPage('p-end');
    const tik = CONFIG.tiktokUrl ? `<a href="${CONFIG.tiktokUrl}" target="_blank" rel="noopener">TikTok</a>` : '';
    page.querySelector('.inner').innerHTML = `
      <h2>Gracias por leer</h2>
      <p>Si alguna oda se quedó contigo, llévate el libro o escríbeme.</p>
      <a class="btn primary" href="${buyHref()}">Comprar el libro</a>
      <p class="contact"><a href="mailto:${CONFIG.email}">${CONFIG.email}</a>${tik}</p>`;
    return { el: page, kind: 'end' };
  }

  // ------------------------------------------------------------- paginación
  flowFor(page, fs, poem, k, first, art) {
    const inner = page.querySelector('.inner');
    inner.innerHTML = '';
    const flow = el('div', 'flow');
    flow.style.setProperty('--fs', fs + 'px');
    inner.appendChild(flow);
    let artEl = null;
    if (art) {
      const fw = inner.clientWidth, fh = inner.clientHeight;
      let w = fw * art, h = w * 4 / 3;
      if (h > fh) { h = fh; w = h * 3 / 4; }
      const spacer = el('div', 'spacer');
      spacer.style.height = Math.max(0, fh - h) + 'px';
      artEl = el('div', 'art');
      artEl.style.width = w + 'px'; artEl.style.height = h + 'px';
      if (w > fw * 0.9) { artEl.style.marginLeft = '0'; spacer.style.width = ((fw - w) / 2) + 'px'; }
      flow.append(spacer, artEl);
    }
    if (first) {
      flow.appendChild(el('p', 'num', ROMAN[k]));
      flow.appendChild(el('h2', null, poem.title));
    }
    return { flow, artEl, limit: inner.clientHeight };
  }

  // Coloca unidades (versos / pausas) mientras quepan. Devuelve el índice siguiente.
  fill(flow, units, i, limit) {
    const fits = n => n.offsetTop + n.offsetHeight <= limit + 0.5;
    let st = null;
    while (i < units.length && units[i].t === 'br') i++;
    for (; i < units.length; i++) {
      const u = units[i];
      if (u.t === 'br') { st = null; continue; }
      if (!st) { st = el('div', 'st'); flow.appendChild(st); }
      const ln = el('div', 'ln' + (u.prose ? ' pr' : '') + (u.cont ? ' cont' : ''));
      ln.textContent = u.s;
      st.appendChild(ln);
      if (fits(ln)) continue;
      if (u.prose) {
        const words = u.s.split(' ');
        let lo = 0, hi = words.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          ln.textContent = words.slice(0, mid).join(' ');
          if (fits(ln)) lo = mid; else hi = mid - 1;
        }
        if (lo >= 4) {
          // cortar en la última línea completa para no dejar una palabra suelta
          ln.textContent = words.slice(0, lo).join(' ');
          const h = ln.offsetHeight;
          let a = 1, z = lo;
          while (a < z) {
            const mid = (a + z + 1) >> 1;
            ln.textContent = words.slice(0, mid).join(' ');
            if (ln.offsetHeight < h) a = mid; else z = mid - 1;
          }
          if (a >= 4 && a < lo) lo = a;
          ln.textContent = words.slice(0, lo).join(' ');
          ln.style.textAlignLast = 'justify';
          units.splice(i + 1, 0, { t: 'ln', s: words.slice(lo).join(' '), prose: true, cont: true });
          return i + 1;
        }
      }
      ln.remove();
      if (!st.children.length) st.remove();
      return i;
    }
    return i;
  }

  makePoemPage(k) {
    const page = this.newPage('p-poem');
    this.meas.innerHTML = '';
    this.meas.appendChild(page);
    return page;
  }

  // Escritorio: cada oda ocupa exactamente un pliego (izquierda texto, derecha texto + acuarela).
  // Se busca la acuarela más grande posible reduciendo un poco la letra; si no cabe,
  // se reduce la letra hasta que todo entre con la acuarela al 60 %.
  paginateSpread(poem, k) {
    const max = this.pw * 0.037, min = this.pw * 0.019;
    const attempt = (fs, art) => {
      const units = unitsOf(poem.text);
      const a = this.makePoemPage(k);
      const fa = this.flowFor(a, fs, poem, k, true, 0);
      const j = this.fill(fa.flow, units, 0, fa.limit);
      const b = this.newPage('p-poem');
      this.meas.appendChild(b);
      const rest = units.slice(j).some(u => u.t === 'ln');
      const fb = this.flowFor(b, fs, poem, k, false, rest ? art : 0.96);
      const j2 = rest ? this.fill(fb.flow, units, j, fb.limit) : units.length;
      return { a, b, artEl: fb.artEl, ok: j2 >= units.length };
    };
    let r = null;
    search:
    for (const art of [0.96, 0.86, 0.76, 0.68]) {
      for (let fs = max; fs >= max * 0.8; fs *= 0.965) {
        r = attempt(fs, art);
        if (r.ok) break search;
      }
    }
    if (!r.ok) for (let fs = max; fs >= min; fs *= 0.965) { r = attempt(fs, 0.6); if (r.ok) break; }
    r.a.remove(); r.b.remove();
    const pa = { el: r.a, kind: 'poem', poem: k };
    const pb = { el: r.b, kind: 'poem', poem: k };
    this.attachArt(pb, r.artEl, poem, k);
    return [pa, pb];
  }

  // Móvil: tantas páginas como haga falta; la acuarela va en la primera,
  // para que se vea mientras se escucha el audio.
  paginateSingle(poem, k) {
    const fs = Math.max(14.5, Math.min(17.5, this.pw * 0.043));
    const units = unitsOf(poem.text);
    const out = [];
    let i = 0;
    for (let guard = 0; guard < 20 && (i === 0 || i < units.length); guard++) {
      const first = i === 0 && !out.length;
      const page = this.makePoemPage(k);
      const f = this.flowFor(page, fs, poem, k, first, first ? 0.8 : 0);
      i = this.fill(f.flow, units, i, f.limit);
      page.remove();
      const p = { el: page, kind: 'poem', poem: k };
      if (first) this.attachArt(p, f.artEl, poem, k);
      out.push(p);
      if (!units.slice(i).some(u => u.t === 'ln')) break;
    }
    return out;
  }

  attachArt(p, artEl, poem, k) {
    const hint = el('button', 'listen', '<i></i><span>escuchar la oda</span>');
    hint.type = 'button';
    hint.addEventListener('click', e => { e.stopPropagation(); this.playPoem(k); });
    artEl.appendChild(hint);
    p.hint = hint;
    p.hintPoem = k;
    const img = el('img', 'art-base');
    img.src = poem.image; img.alt = poem.title;
    if (!supported) img.classList.add('full');
    artEl.prepend(img);
    if (!supported) return;
    this.addArt(p, poem.splats, () => {
      let x = 0, y = 0, n = artEl;
      while (n && n !== p.el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      return { x, y, w: artEl.offsetWidth };
    }, { poem: k });
  }

  addArt(p, url, rect, opts) {
    const canvas = el('canvas', 'splat-layer');
    p.el.appendChild(canvas);
    p.art = { canvas, url, rect, ...opts };
  }

  ensureView(p) {
    if (!p.art || p.view || !supported) return;
    const a = p.art;
    // la imagen ya está completa; los splats solo reaccionan al puntero
    p.view = createView(a.canvas, a.url, { getRect: a.rect, initial: 1, target: () => 1 });
  }

  // ------------------------------------------------------------- montaje
  mountSpread() {
    const n = this.pages.length / 2;
    this.leaves = [];
    for (let i = 0; i < n; i++) {
      const leaf = el('div', 'leaf');
      const front = el('div', 'face front'), back = el('div', 'face back');
      front.appendChild(this.pages[2 * i].el);
      back.appendChild(this.pages[2 * i + 1].el);
      front.appendChild(el('div', 'shade')); back.appendChild(el('div', 'shade'));
      leaf.append(front, back);
      this.bookEl.appendChild(leaf);
      this.leaves.push(leaf);
    }
    this.pos = 0;
    this.applySpread(false);
  }

  mountSingle() {
    this.wraps = this.pages.map((p, i) => {
      const w = el('div', 'mpage');
      w.appendChild(p.el);
      w.style.zIndex = String(this.pages.length - i);
      this.bookEl.appendChild(w);
      return w;
    });
    this.pos = 0;
  }

  applySpread(animate) {
    const L = this.leaves.length;
    this.leaves.forEach((leaf, i) => {
      const flipped = i < this.pos;
      if (!animate) leaf.style.transition = 'none';
      leaf.classList.toggle('flipped', flipped);
      if (!leaf.classList.contains('turning')) leaf.style.zIndex = String(flipped ? i + 1 : L - i);
      if (!animate) { void leaf.offsetWidth; leaf.style.transition = ''; }
    });
    const shift = this.pos === 0 ? -25 : this.pos === L ? 25 : 0;
    if (!animate) this.bookEl.style.transition = 'none';
    this.bookEl.style.transform = `translateX(${shift}%)`;
    this.bookEl.classList.toggle('closed-front', this.pos === 0);
    this.bookEl.classList.toggle('closed-back', this.pos === L);
    if (!animate) { void this.bookEl.offsetWidth; this.bookEl.style.transition = ''; }
  }

  // ------------------------------------------------------------- navegación
  get maxPos() { return this.mode === 'spread' ? this.leaves.length : this.pages.length - 1; }

  visiblePages(pos = this.pos) {
    if (this.mode === 'spread') return [this.pages[2 * pos - 1], this.pages[2 * pos]].filter(Boolean);
    return [this.pages[pos]].filter(Boolean);
  }

  next() { if (this.pos < this.maxPos) this.goTo(this.pos + 1); }
  prev() { if (this.pos > 0) this.goTo(this.pos - 1); }

  goTo(target, instant = false) {
    target = Math.max(0, Math.min(this.maxPos, target));
    const from = this.pos;
    if (target === from && !instant) return;
    const before = this.visiblePages(from);
    this.pos = target;
    const steps = Math.abs(target - from);
    const dir = Math.sign(target - from);
    if (this.mode === 'spread') {
      if (instant) this.applySpread(false);
      else {
        const L = this.leaves.length;
        for (let s = 0; s < steps; s++) {
          const i = dir > 0 ? from + s : from - 1 - s;
          const leaf = this.leaves[i];
          setTimeout(() => {
            leaf.classList.add('turning');
            leaf.style.zIndex = String(L + 10 + s);
            leaf.classList.toggle('flipped', dir > 0);
            setTimeout(() => {
              leaf.classList.remove('turning');
              leaf.style.zIndex = String(i < this.pos ? i + 1 : L - i);
            }, FLIP_MS);
          }, s * 140);
        }
        const shift = this.pos === 0 ? -25 : this.pos === L ? 25 : 0;
        this.bookEl.style.transform = `translateX(${shift}%)`;
        this.bookEl.classList.toggle('closed-front', this.pos === 0);
        this.bookEl.classList.toggle('closed-back', this.pos === L);
      }
    } else {
      this.wraps.forEach((w, i) => {
        if (instant) w.style.transition = 'none';
        w.classList.toggle('gone', i < this.pos);
        if (instant) { void w.offsetWidth; w.style.transition = ''; }
      });
    }
    const dur = instant ? 0 : FLIP_MS + (steps - 1) * 140;
    this.busyUntil = performance.now() + dur;
    // durante el giro, las páginas de antes y de después siguen vivas
    before.forEach(p => this.show(p, true));
    this.refreshVisible(before);
    clearTimeout(this._vt);
    this._vt = setTimeout(() => this.refreshVisible(), dur + 30);
    this.onPositionChange();
  }

  goToPoem(k, instant = false) {
    const start = this.poemStart[k];
    const pos = this.mode === 'spread' ? Math.ceil(start / 2) : start;
    this.goTo(pos, instant);
  }

  show(p, v) {
    if (!p) return;
    if (v) this.ensureView(p);
    if (p.view) setVisible(p.view, v);
  }

  refreshVisible(extra = []) {
    const vis = new Set([...this.visiblePages(), ...extra]);
    // precarga de las páginas vecinas
    const near = this.mode === 'spread'
      ? [this.pages[2 * this.pos + 1], this.pages[2 * this.pos + 2]]
      : [this.pages[this.pos + 1]];
    near.forEach(p => p && p.art && this.ensureView(p));
    this.pages.forEach(p => this.show(p, vis.has(p) && !this.root.hidden));
  }

  anchor() {
    if (!this.pages.length) return null;
    const p = this.visiblePages().find(p => p.poem != null) || this.visiblePages()[0];
    return p ? { kind: p.kind, poem: p.poem } : null;
  }

  restore(a) {
    if (!a) return this.goTo(0, true);
    if (a.poem != null) return this.goToPoem(a.poem, true);
    const i = this.pages.findIndex(p => p.kind === a.kind);
    const pos = this.mode === 'spread' ? Math.ceil(Math.max(0, i) / 2) : Math.max(0, i);
    this.goTo(pos, true);
  }

  currentPoem() {
    const p = this.visiblePages().find(p => p.poem != null);
    return p ? p.poem : -1;
  }

  onPositionChange() {
    const k = this.currentPoem();
    const slug = k >= 0 ? this.poems[k].slug : '';
    const hash = '#libro' + (slug ? '/' + slug : '');
    if (location.hash !== hash) history.replaceState(null, '', hash);
    if (k !== this.audioPoem) this.loadPoem(k, this.continueNext);
    this.continueNext = false;
    this.root.querySelector('[data-prev]').disabled = this.pos === 0;
    this.root.querySelector('[data-next]').disabled = this.pos === this.maxPos;
  }

  // ------------------------------------------------------------- audio
  progressFor(k) {
    let ratio;
    if (k === this.audioPoem && this.audio.duration) ratio = this.audio.currentTime / this.audio.duration;
    else ratio = this.saved[k].ratio;
    return Math.min(1, ratio / 0.5);
  }

  loadPoem(k, autoplay) {
    const a = this.audio;
    if (this.audioPoem >= 0) {
      const s = this.saved[this.audioPoem];
      if (!a.ended) s.t = a.currentTime;
    }
    a.pause();
    this.audioPoem = k;
    const ui = this.ui;
    if (k < 0) {
      ui.player.classList.add('off');
      ui.now.textContent = 'Pasa la página para escuchar';
      ui.fill.style.width = '0'; ui.time.textContent = '';
      this.setPlaying(false);
      return;
    }
    const poem = this.poems[k];
    ui.player.classList.remove('off');
    ui.now.textContent = poem.title;
    a.src = poem.audio;
    const t = this.saved[k].t;
    const startAt = () => { a.currentTime = Math.min(t, (a.duration || t + 1) - 0.05); this.updateBar(); };
    if (t > 0) a.addEventListener('loadedmetadata', startAt, { once: true });
    if (autoplay) a.play().catch(() => {});
    this.setPlaying(autoplay);
    this.updateBar();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: poem.title, artist: 'El escritor de odas', album: 'El girasol que cobró consciencia de sol',
        artwork: [{ src: poem.image, sizes: '600x800', type: 'image/jpeg' }],
      });
    }
  }

  playPoem(k) {
    if (k !== this.audioPoem) this.loadPoem(k, true);
    else if (this.audio.paused) {
      if (this.audio.ended) this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    }
  }

  setPlaying(on) {
    this.ui.play.classList.toggle('on', on);
    this.ui.play.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir');
  }

  updateBar() {
    const a = this.audio, ui = this.ui;
    if (this.audioPoem < 0) return;
    const d = a.duration || 0, t = a.currentTime || 0;
    ui.fill.style.width = d ? (t / d * 100) + '%' : '0';
    ui.time.textContent = d ? `${fmt(t)} / ${fmt(d)}` : fmt(t);
    if (d) this.saved[this.audioPoem].ratio = t / d;
    this.pages.forEach(p => p.hint && p.hint.classList.toggle('hide', this.progressFor(p.hintPoem) > 0.02 || (p.hintPoem === this.audioPoem && !a.paused)));
  }

  initPlayer() {
    const r = this.root;
    this.ui = {
      player: r.querySelector('#player'), play: r.querySelector('.play'), now: r.querySelector('.now'),
      bar: r.querySelector('.bar'), fill: r.querySelector('.bar .fill'), time: r.querySelector('.time'),
    };
    const a = this.audio, ui = this.ui;
    ui.play.addEventListener('click', () => {
      if (this.audioPoem < 0) return;
      if (a.paused) this.playPoem(this.audioPoem); else a.pause();
    });
    a.addEventListener('play', () => { this.setPlaying(true); this.updateBar(); });
    a.addEventListener('pause', () => { this.setPlaying(false); this.updateBar(); });
    a.addEventListener('timeupdate', () => this.updateBar());
    a.addEventListener('loadedmetadata', () => this.updateBar());
    a.addEventListener('ended', () => {
      const k = this.audioPoem;
      this.saved[k] = { t: 0, ratio: 1 };
      this.setPlaying(false);
      if (CONFIG.autoContinue && k < this.poems.length - 1) {
        setTimeout(() => {
          if (this.audioPoem !== k || this.root.hidden) return;
          this.continueNext = true;
          this.goToPoem(k + 1);
        }, 2200);
      }
    });
    const seek = e => {
      const b = ui.bar.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
      if (a.duration) {
        a.currentTime = x * a.duration;
        this.saved[this.audioPoem].ratio = x;
        this.updateBar();
      }
    };
    ui.bar.addEventListener('pointerdown', e => {
      e.stopPropagation();
      ui.bar.setPointerCapture(e.pointerId);
      seek(e);
      const move = ev => seek(ev);
      ui.bar.addEventListener('pointermove', move);
      ui.bar.addEventListener('pointerup', () => ui.bar.removeEventListener('pointermove', move), { once: true });
    });
    ui.bar.addEventListener('keydown', e => {
      if (!a.duration) return;
      if (e.key === 'ArrowRight') { a.currentTime = Math.min(a.duration, a.currentTime + 5); e.stopPropagation(); }
      if (e.key === 'ArrowLeft') { a.currentTime = Math.max(0, a.currentTime - 5); e.stopPropagation(); }
    });
  }

  // ------------------------------------------------------------- entrada
  initInput() {
    const r = this.root;
    r.querySelector('[data-next]').addEventListener('click', () => this.next());
    r.querySelector('[data-prev]').addEventListener('click', () => this.prev());

    let down = null;
    this.stage.addEventListener('pointerdown', e => {
      if (e.target.closest('button, a, .bar')) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.stage.addEventListener('pointermove', e => this.feedPointer(e));
    this.stage.addEventListener('pointerleave', () => this.pages.forEach(p => p.view && pointer(p.view, 0, 0, false)));
    this.stage.addEventListener('pointerup', e => {
      if (e.pointerType !== 'mouse') this.pages.forEach(p => p.view && pointer(p.view, 0, 0, false));
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
      down = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? this.next() : this.prev(); return; }
      if (Math.hypot(dx, dy) < 8 && dt < 500) this.tap(e);
    });
    window.addEventListener('keydown', e => {
      if (r.hidden) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
      else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); this.ui.play.click(); }
    });
  }

  feedPointer(e) {
    if (performance.now() < this.busyUntil) return;
    for (const p of this.visiblePages()) {
      if (!p.view) continue;
      const b = p.el.getBoundingClientRect();
      const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      pointer(p.view, e.clientX, e.clientY, inside);
    }
  }

  tap(e) {
    const b = this.bookEl.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    if (this.pos === 0) return this.next();
    if (this.mode === 'spread') {
      if (this.pos === this.maxPos) return this.prev();
      if (x > 0.9) this.next(); else if (x < 0.1) this.prev();
    } else {
      if (x > 0.72) this.next(); else if (x < 0.28) this.prev();
    }
  }
}
