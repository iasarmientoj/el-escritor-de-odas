// Lector del libro: paginación, paso de página y audio sincronizado con los splats.
import { createView, destroyView, setVisible, pointer, supported } from './splats.js';
import { CONFIG, buyHref } from './config.js';
import { eventoUnaVez } from './analitica.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const COVER_SPLATS = 'assets/splats/oda-al-girasol-feliz.bin';
const FLIP_MS = 1000;
const FS_REF = 'oda-a-la-imposibilidad-de-amar-iii';   // oda que fija el tamaño de letra

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
      if (this.root.hidden) { this.stale = true; return; }
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
    if (this.wake) this.wake();
    if ((!this.pages.length && this.mode !== 'scroll') || this.stale || (this.mode === 'scroll' && !this.scrollSecs)) { this.build(); this.stale = false; }
    const idx = slug ? this.poems.findIndex(p => p.slug === slug) : -1;
    if (idx >= 0) this.goToPoem(idx, first);
    else if (first) this.goTo(0, true);
    this.refreshVisible();
  }

  // Arma las páginas de antemano (con el lector invisible) para que abrir el libro
  // no congele la animación de entrada.
  prebuild() {
    if (this.pages.length || !this.root.hidden) return;
    const r = this.root;
    this.quiet = true;
    r.style.visibility = 'hidden';
    r.hidden = false;
    this.build();
    this.goTo(0, true);
    r.hidden = true;
    r.style.visibility = '';
    this.quiet = false;
    this.pages.forEach(p => p.view && setVisible(p.view, false));
  }

  close() {
    this.audio.pause();
    this.root.classList.remove('show');
    setTimeout(() => {
      this.root.hidden = true;
      document.body.style.overflow = '';
      this.pages.forEach(p => p.view && setVisible(p.view, false));
      if (this.sArt && this.sArt.view) setVisible(this.sArt.view, false);
    }, 450);
  }

  // ------------------------------------------------------------- construcción
  measure() {
    const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    // el libro abierto a doble página solo si cada página queda de un tamaño legible
    const spreadPw = Math.floor(Math.min((sw - 120) / 2, (sh - 40) * 0.75));
    const desktop = sw >= 720 && sw > sh * 1.12 && spreadPw >= 330;
    let pw, ph;
    if (desktop) {
      pw = spreadPw;
      ph = Math.floor(pw * 4 / 3);
    } else if (sw > sh) {
      // celular acostado: una sola página apaisada que ocupa la pantalla
      pw = Math.floor(Math.min(sw - 110, 620));
      ph = Math.floor(sh - 24);
    } else {
      const availW = sw - 24, availH = sh - 96;
      pw = Math.floor(Math.min(availW, 560, availH / 1.2));
      ph = Math.floor(Math.min(availH, pw * 1.72));
    }
    return { mode: desktop ? 'spread' : 'single', pw, ph };
  }

  build() {
    const anchor = this.anchor();
    this.pages.forEach(p => p.view && destroyView(p.view));
    if (this.sArt && this.sArt.view) destroyView(this.sArt.view);
    this.sArt = null;
    this.artGeoms = [];
    this.pages = [];
    const { mode, pw, ph } = this.measure();
    if (mode !== 'spread') { this.buildScroll(anchor); return; }
    this.root.classList.remove('scrolling');
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
    // Un solo tamaño de letra para todas las odas: el que necesita la más larga
    // («Imposibilidad III»), para que el libro se vea parejo.
    this.fixedFs = null;
    if (mode === 'spread') {
      const ref = Math.max(0, this.poems.findIndex(p => p.slug === FS_REF));
      const probe = this.paginateSpread(this.poems[ref], ref);
      this.fixedFs = probe.fs;
      this.artGeoms = [];
    }
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

  // ------------------------------------------------------------- celular: lectura con scroll
  // Cada oda completa, con su acuarela al final. Sin pasar páginas.
  buildScroll(anchor) {
    this.mode = 'scroll';
    this.root.classList.add('scrolling');
    this.stage.classList.remove('at-cover');
    const book = this.bookEl;
    book.className = 'book scroll';
    book.style.width = ''; book.style.height = ''; book.style.transform = '';
    book.innerHTML = '';
    const doc = el('div', 'scroll-doc');
    const tik = CONFIG.tiktokUrl ? `<a href="${CONFIG.tiktokUrl}" target="_blank" rel="noopener">Sígueme en TikTok</a>` : '';
    doc.insertAdjacentHTML('beforeend', `
      <section class="s-cover">
        <h1>El girasol<em>que cobró consciencia de sol</em></h1>
        <img src="assets/img/oda-al-girasol-feliz.jpg" alt="">
        <p class="s-by">El escritor de odas</p>
      </section>
      <section class="s-epigraph">
        <blockquote>Quizá por eso llora amarillo.<br>No porque no alcance al sol,<br>Sino porque nadie le ha dicho<br>Que ya lo es.</blockquote>
        <cite>— Oda al girasol triste</cite>
      </section>
      <section class="s-index"><h2>Índice</h2><ol></ol></section>`);
    const ol = doc.querySelector('.s-index ol');
    this.scrollSecs = this.poems.map((poem, k) => {
      const li = el('li');
      const b = el('button', null, `<span>${ROMAN[k]}.</span> ${poem.title}`);
      b.type = 'button';
      b.addEventListener('click', () => this.scrollToPoem(k));
      li.appendChild(b); ol.appendChild(li);
      const sec = el('section', 's-poem');
      sec.dataset.poem = k;
      sec.appendChild(el('p', 'num', ROMAN[k]));
      sec.appendChild(el('h2', null, poem.title));
      const body = el('div', 'flow-s');
      let st = null;
      unitsOf(poem.text).forEach(u => {
        if (u.t === 'br') { st = null; return; }
        if (!st) { st = el('div', 'st'); body.appendChild(st); }
        const ln = el('div', 'ln' + (u.prose ? ' pr' : ''));
        ln.textContent = u.s;
        st.appendChild(ln);
      });
      sec.appendChild(body);
      const fig = el('figure');
      const img = el('img'); img.src = poem.image; img.alt = poem.title; img.loading = 'lazy';
      fig.appendChild(img);
      sec.appendChild(fig);
      doc.appendChild(sec);
      return sec;
    });
    doc.insertAdjacentHTML('beforeend', `
      <section class="s-end">
        <h2>Gracias por leer</h2>
        <p>Si alguna oda se quedó contigo, llévate el libro o escríbeme&nbsp;por&nbsp;TikTok.</p>
        <a class="btn primary" href="${buyHref()}" target="_blank" rel="noopener">Comprar el libro</a>
        <p class="contact">${tik}</p>
        <p class="license">© 2026 Iván Sarmiento · <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es" target="_blank" rel="noopener license">CC BY-NC-ND 4.0</a>: puedes compartirlo citando al autor, sin venderlo ni modificarlo.</p>
      </section>`);
    book.appendChild(doc);
    this.scrollPoem = -1;
    if (!this._onScroll) {
      this._onScroll = () => {
        if (this.mode !== 'scroll' || this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => { this._scrollRaf = 0; this.scrollChanged(); });
      };
      book.addEventListener('scroll', this._onScroll, { passive: true });
    }
    const k = anchor && anchor.poem != null ? anchor.poem : -1;
    if (k >= 0) requestAnimationFrame(() => this.scrollToPoem(k, true));
    else book.scrollTop = 0;
    this.scrollChanged();
  }

  scrollToPoem(k, instant = false) {
    const sec = this.scrollSecs && this.scrollSecs[k];
    if (sec) this.bookEl.scrollTo({ top: sec.offsetTop - 64, behavior: instant ? 'auto' : 'smooth' });
  }

  // qué oda se está leyendo: la que ocupa la línea a un 40 % de la pantalla
  scrollChanged() {
    const line = this.bookEl.scrollTop + this.bookEl.clientHeight * 0.4;
    let k = -1;
    (this.scrollSecs || []).forEach((sec, i) => {
      if (sec.offsetTop <= line && sec.offsetTop + sec.offsetHeight > line) k = i;
    });
    if (k === this.scrollPoem) return;
    this.scrollPoem = k;
    const hash = '#libro' + (k >= 0 ? '/' + this.poems[k].slug : '');
    if (!this.quiet && !this.root.hidden && location.hash !== hash) history.replaceState(null, '', hash);
    // el audio arranca solo si la persona ya tocó la página (lo exige el navegador)
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (k !== this.audioPoem) this.loadPoem(k, !this.quiet && !this.root.hidden && k >= 0 && active);
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
      return { x: this.pw * 0.13, y: this.ph - w * 4 / 3 - this.ph * 0.075, w };
    }, { cover: true });
    return p;
  }

  epigraphPage() {
    const page = this.newPage('p-epigraph');
    page.querySelector('.inner').innerHTML = `
      <blockquote>Quizá por eso llora amarillo.<br>No porque no alcance al sol,<br>Sino porque nadie le ha dicho<br>Que ya lo es.</blockquote>
      <cite>— Oda al girasol triste</cite>`;
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
    const tik = CONFIG.tiktokUrl ? `<a href="${CONFIG.tiktokUrl}" target="_blank" rel="noopener">Sígueme en TikTok</a>` : '';
    page.querySelector('.inner').innerHTML = `
      <h2>Gracias por leer</h2>
      <p class="end-msg">Si alguna oda se quedó contigo, llévate el libro o escríbeme&nbsp;por&nbsp;TikTok.</p>
      <a class="btn primary" href="${buyHref()}" target="_blank" rel="noopener">Comprar el libro</a>
      <p class="contact">${tik}</p>
      <p class="license">© 2026 Iván Sarmiento<br><a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es" target="_blank" rel="noopener license">CC BY-NC-ND 4.0</a>: puedes compartirlo citando al autor, sin venderlo ni modificarlo.</p>`;
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
  fill(flow, units, i, limit, stop = Infinity) {
    const fits = n => n.offsetTop + n.offsetHeight <= limit + 0.5;
    let st = null;
    while (i < units.length && units[i].t === 'br') i++;
    for (; i < units.length && i < stop; i++) {
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

  // Escritorio: la acuarela flota en el centro del pliego, sobre el lomo, y la oda se
  // reparte en la página izquierda y la derecha rodeando la silueta del dibujo.
  // Para cada tamaño de acuarela se busca la letra más grande que cabe y gana la
  // combinación con mejor puntuación (primero letra legible, luego acuarela grande).
  paginateSpread(poem, k) {
    const max = this.pw * 0.037, min = this.pw * 0.02;
    const attempt = (fs, wf, balance = false) => {
      const g = this.artGeom(wf);
      const units = unitsOf(poem.text);
      let a = this.makePoemPage(k);
      let fa = this.flowSpread(a, fs, poem, k, true, 'left', g);
      let j = this.fill(fa.flow, units.slice(), 0, fa.limit);
      // repartir la oda entre las dos páginas: cortar en la pausa entre estrofas
      // más cercana a la mitad (sin pasar de lo que cabe a la izquierda)
      const lines = units.map((u, i) => u.t === 'ln' ? i : -1).filter(i => i >= 0);
      const half = lines[Math.floor(lines.length / 2)];
      let cut = -1;
      if (balance) units.forEach((u, i) => { if (u.t === 'br' && i <= j && (cut < 0 || Math.abs(i - half) < Math.abs(cut - half))) cut = i; });
      a.remove();
      a = this.makePoemPage(k);
      fa = this.flowSpread(a, fs, poem, k, true, 'left', g);
      j = this.fill(fa.flow, units, 0, fa.limit, cut > 0 ? cut : Infinity);
      const b = this.newPage('p-poem');
      this.meas.appendChild(b);
      const fb = this.flowSpread(b, fs, poem, k, false, 'right', g);
      const j2 = this.fill(fb.flow, units, j, fb.limit);
      return { a, b, g, fs, ok: !units.slice(j2).some(u => u.t === 'ln') };
    };
    let best = null, bestScore = -1;
    // con tamaño fijo: solo se elige la acuarela más grande que deja caber la oda
    if (this.fixedFs) {
      // primero repartiendo la oda entre las dos páginas; si no cabe, sin repartir
      for (const balance of [true, false]) {
        for (const wf of [0.86, 0.78, 0.7, 0.62, 0.54, 0.48, 0.42]) {
          const r = attempt(this.fixedFs, wf, balance);
          if (r.ok) { best = r; break; }
        }
        if (best) break;
      }
    }
    if (!best) for (const wf of [0.86, 0.78, 0.7, 0.62, 0.54, 0.48, 0.42]) {
      let ok = null;
      const first = attempt(max, wf);
      if (first.ok) ok = first;
      else {
        let lo = min, hi = max;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          const r = attempt(mid, wf);
          if (r.ok) { ok = r; lo = mid; } else hi = mid;
        }
      }
      if (ok) {
        const score = (ok.fs / max) * 2.5 + wf * 0.6;
        if (score > bestScore) { bestScore = score; best = ok; }
      }
    }
    if (!best) best = attempt(min, 0.54);
    best.a.remove(); best.b.remove();
    this.artGeoms[k] = best.g;
    const out = [{ el: best.a, kind: 'poem', poem: k }, { el: best.b, kind: 'poem', poem: k }];
    out.fs = best.fs;
    return out;
  }

  // Tamaño y altura de la acuarela flotante (px de página); su centro cae en el lomo.
  artGeom(wf) {
    const w = Math.min(this.pw * wf, this.ph * 0.86 * 0.75);
    const h = w * 4 / 3;
    return { w, h, top: (this.ph - h) / 2 + this.ph * 0.015 };
  }

  // Flujo de una página del pliego con un hueco (shape-outside) que sigue la silueta.
  flowSpread(page, fs, poem, k, first, side, g) {
    const inner = page.querySelector('.inner');
    inner.innerHTML = '';
    const flow = el('div', 'flow');
    flow.style.setProperty('--fs', fs + 'px');
    inner.appendChild(flow);
    const iw = inner.clientWidth, il = inner.offsetLeft, it = inner.offsetTop;
    const prof = poem.profile || [];
    const n = prof.length;
    const top = Math.max(0, g.top - it);
    // borde izquierdo de la imagen en coordenadas del flujo de esta página
    const imgLeft = side === 'left' ? this.pw - g.w / 2 - il : -g.w / 2 - il;
    let boxW, pts;
    if (side === 'left') {
      const start = Math.max(0, imgLeft);
      boxW = iw - start;
      pts = prof.map(([x0], j) => [x0 < 0 ? boxW : Math.min(boxW, Math.max(0, imgLeft + g.w * x0 - start)), j / (n - 1) * g.h]);
    } else {
      boxW = Math.max(0, Math.min(iw, imgLeft + g.w * 1.06));
      // margen extra a la derecha del dibujo: el texto de esta página nunca debe rozarlo
      const extra = g.w * 0.06;
      pts = prof.map(([, x1], j) => [x1 < 0 ? 0 : Math.min(boxW, Math.max(0, imgLeft + g.w * x1 + extra)), j / (n - 1) * g.h]);
    }
    if (boxW > 2 && n > 1) {
      const edge = side === 'left' ? boxW : 0;
      const poly = [[edge, 0], ...pts, [edge, g.h]].map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ');
      const spacer = el('div', 'spacer ' + side);
      spacer.style.height = top + 'px';
      const shape = el('div', 'art-shape ' + side);
      shape.style.width = boxW + 'px';
      shape.style.height = g.h + 'px';
      shape.style.shapeOutside = `polygon(${poly})`;
      flow.append(spacer, shape);
    }
    if (first) {
      flow.appendChild(el('p', 'num', ROMAN[k]));
      flow.appendChild(el('h2', null, poem.title));
    }
    return { flow, limit: inner.clientHeight };
  }

  // Capa de la acuarela que flota sobre el pliego (una sola para todo el libro).
  makeSpreadArt() {
    const box = el('div', 'spread-art');
    const img = el('img', 'art-base');
    img.alt = '';
    const canvas = el('canvas', 'splat-layer');
    box.append(img, canvas);
    this.bookEl.appendChild(box);
    this.sArt = { box, img, canvas, view: null, poem: -1, t: 0 };
  }

  // Al cambiar de pliego: se apaga la acuarela, pasa la hoja y aparece la nueva.
  updateSpreadArt(instant, delay = 0) {
    const s = this.sArt;
    if (this.mode !== 'spread' || !s) return;
    const k = this.currentPoem();
    clearTimeout(s.t);
    if (k === s.poem) { s.box.classList.toggle('on', k >= 0); return; }
    s.box.classList.remove('on');
    const swap = () => {
      if (s.view) { destroyView(s.view); s.view = null; }
      s.poem = k;
      if (k < 0) return;
      const g = this.artGeoms[k], P = g.w * 0.14, poem = this.poems[k];
      Object.assign(s.box.style, {
        left: (this.pw - g.w / 2 - P) + 'px', top: (g.top - P) + 'px',
        width: (g.w + 2 * P) + 'px', height: (g.h + 2 * P) + 'px',
      });
      Object.assign(s.img.style, { left: P + 'px', top: P + 'px', width: g.w + 'px', height: g.h + 'px' });
      s.img.src = poem.imageAlpha || poem.image;
      if (supported) {
        s.view = createView(s.canvas, poem.splats, { getRect: () => ({ x: P, y: P, w: g.w }), initial: 1, target: () => 1 });
        setVisible(s.view, !this.root.hidden);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => s.box.classList.add('on')));
    };
    if (instant) swap(); else s.t = setTimeout(swap, Math.max(300, delay));
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
      const f = this.flowFor(page, fs, poem, k, first, 0);
      let artEl = null;
      let limit = f.limit;
      if (first) {
        const inner = page.querySelector('.inner');
        const fw = inner.clientWidth, fh = inner.clientHeight;
        artEl = el('div', 'art art-mobile');
        if (this.pw > this.ph) {
          // celular acostado: la acuarela a la derecha, a toda la altura, y el texto a su lado
          const h = fh, w = h * 3 / 4;
          Object.assign(artEl.style, { position: 'absolute', width: w + 'px', height: h + 'px', right: '0', top: '0' });
          inner.appendChild(artEl);
          f.flow.style.right = (w + fs) + 'px';
        } else {
          // celular de pie: la acuarela abajo y centrada, como máximo media página
          const h = Math.min(fh * 0.5, fw * 0.9 * 4 / 3), w = h * 3 / 4;
          Object.assign(artEl.style, { position: 'absolute', width: w + 'px', height: h + 'px', left: ((fw - w) / 2) + 'px', bottom: '0' });
          f.flow.appendChild(artEl);
          limit = fh - h - fs;
        }
      }
      i = this.fill(f.flow, units, i, limit);
      page.remove();
      const p = { el: page, kind: 'poem', poem: k };
      if (first) this.attachArt(p, artEl, poem, k);
      out.push(p);
      if (!units.slice(i).some(u => u.t === 'ln')) break;
    }
    return out;
  }

  // La caja .art reserva el hueco del texto; la acuarela se pinta más grande y sale
  // por el borde derecho e inferior de la página (a sangre), como una ilustración impresa.
  attachArt(p, artEl, poem, k) {
    const img = el('img', 'art-base');
    img.src = poem.image; img.alt = poem.title;
    if (!supported) img.classList.add('full');
    artEl.prepend(img);
    let last = '';
    const rect = () => {
      let x = 0, y = 0, n = artEl;
      while (n && n !== p.el) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
      const w = artEl.offsetWidth, h = w * 4 / 3;
      const inner = p.el.querySelector('.inner').offsetWidth;
      let w2, x2, y2;
      if (w > inner * 0.9) {
        // página solo con acuarela: un poco más grande, centrada y baja
        w2 = w * 1.12; x2 = x + (w - w2) / 2; y2 = y + h - w2 * 4 / 3 + h * 0.05;
      } else {
        // crece solo hacia la derecha y hacia abajo: nunca tapa el texto
        w2 = w * 1.22;
        x2 = x;
        y2 = y;
      }
      const key = `${x2 - x}|${y2 - y}|${w2}`;
      if (key !== last) {
        last = key;
        Object.assign(img.style, { left: (x2 - x) + 'px', top: (y2 - y) + 'px', width: w2 + 'px', height: (w2 * 4 / 3) + 'px', inset: 'auto' });
      }
      return { x: x2, y: y2, w: w2 };
    };
    p.artRect = rect;
    if (!supported) return;
    this.addArt(p, poem.splats, rect, { poem: k });
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
    this.makeSpreadArt();
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
    if (this.mode === 'scroll') { if (target === 0) this.bookEl.scrollTo({ top: 0 }); return; }
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
    this.updateSpreadArt(instant, dur - 150);
  }

  goToPoem(k, instant = false) {
    if (this.mode === 'scroll') return this.scrollToPoem(k, instant);
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
    if (this.sArt && this.sArt.view) setVisible(this.sArt.view, !this.root.hidden);
  }

  anchor() {
    if (this.mode === 'scroll') return this.scrollPoem >= 0 ? { kind: 'poem', poem: this.scrollPoem } : null;
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
    if (this.mode === 'scroll') return this.scrollPoem;
    const p = this.visiblePages().find(p => p.poem != null);
    return p ? p.poem : -1;
  }

  onPositionChange() {
    this.stage.classList.toggle('at-cover', this.pos === 0);
    const k = this.currentPoem();
    const slug = k >= 0 ? this.poems[k].slug : '';
    const hash = '#libro' + (slug ? '/' + slug : '');
    if (!this.quiet && location.hash !== hash) history.replaceState(null, '', hash);
    if (k !== this.audioPoem) this.loadPoem(k, !this.quiet && k >= 0);
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
    eventoUnaVez('ver_oda', poem.title);
    ui.player.classList.remove('off');
    ui.now.textContent = poem.title;
    a.src = poem.audio;
    const t = this.saved[k].t;
    const startAt = () => { a.currentTime = Math.min(t, (a.duration || t + 1) - 0.05); this.updateBar(); };
    if (t > 0) a.addEventListener('loadedmetadata', startAt, { once: true });
    if (autoplay) a.play().catch(() => this.setPlaying(false));
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
    a.addEventListener('play', () => {
      this.setPlaying(true); this.updateBar();
      if (this.audioPoem >= 0) eventoUnaVez('escuchar_oda', this.poems[this.audioPoem].title);
    });
    a.addEventListener('pause', () => { this.setPlaying(false); this.updateBar(); });
    a.addEventListener('timeupdate', () => this.updateBar());
    a.addEventListener('loadedmetadata', () => this.updateBar());
    a.addEventListener('ended', () => {
      const k = this.audioPoem;
      if (k >= 0) eventoUnaVez('oda_completa', this.poems[k].title);
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
    const wake = () => {
      r.classList.remove('idle');
      clearTimeout(this._idle);
      this._idle = setTimeout(() => {
        if (!r.querySelector('.reader-bar:hover, .player:hover, .nav:hover')) r.classList.add('idle');
      }, 2800);
    };
    ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => r.addEventListener(ev, wake, { passive: true }));
    this.wake = wake;
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
      if (this.mode === 'scroll') { down = null; return; }
      const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
      down = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? this.next() : this.prev(); return; }
      if (Math.hypot(dx, dy) < 8 && dt < 500) this.tap(e);
    });
    window.addEventListener('keydown', e => {
      if (r.hidden) return;
      if (this.mode === 'scroll') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.prev();
      else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); this.ui.play.click(); }
    });
  }

  feedPointer(e) {
    if (performance.now() < this.busyUntil) return;
    const s = this.sArt;
    if (s && s.view) {
      const b = s.box.getBoundingClientRect();
      pointer(s.view, e.clientX, e.clientY, e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom);
    }
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
