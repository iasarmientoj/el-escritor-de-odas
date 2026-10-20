import { CONFIG, buyHref } from './config.js';
import { createView, destroyView, setVisible, pointer, wipe, supported } from './splats.js';
import { Reader } from './book.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// enlaces configurables
$$('[data-buy]').forEach(a => {
  a.href = buyHref();
  if (CONFIG.buyUrl) { a.target = '_blank'; a.rel = 'noopener'; }
});
$$('[data-tiktok]').forEach(a => {
  if (!CONFIG.tiktokUrl) { a.hidden = true; return; }
  a.href = CONFIG.tiktokUrl; a.target = '_blank'; a.rel = 'noopener';
});

// biblioteca: el resto de la rejilla son libros por venir
const shelf = $('#shelf');
for (let i = 2; i <= 6; i++) {
  const li = document.createElement('li');
  li.className = 'book-card soon';
  li.setAttribute('aria-hidden', 'true');
  li.innerHTML = `
    <div class="book-3d"><span class="book-cover"><span>Próximamente<small>Volumen ${i}</small></span></span><span class="book-pages"></span></div>
    <h3>Próximamente</h3>
    <p class="book-sub">En escritura</p>
    <div class="card-actions"><button class="btn small ghost" type="button" disabled>Comprar</button></div>`;
  shelf.appendChild(li);
}

// portada viva de la biblioteca
const coverCanvas = $('.cover-splats');
const bookBtn = $('.book-3d');
let coverView = null;
if (supported) {
  coverView = createView(coverCanvas, 'assets/splats/oda-al-girasol-feliz.bin', {
    getRect: () => {
      const w = coverCanvas.clientWidth, h = coverCanvas.clientHeight;
      const iw = w * 0.74;
      return { x: w * 0.13, y: h - iw * 4 / 3 - h * 0.075, w: iw };
    },
    target: () => 1, initial: 1,
  });
  const base = new Image();
  base.src = 'assets/img/oda-al-girasol-feliz.jpg'; base.alt = ''; base.className = 'cover-base';
  coverCanvas.before(base);
  setVisible(coverView, true);
  window.addEventListener('pointermove', e => {
    const b = coverCanvas.getBoundingClientRect();
    const pad = 30;
    const inside = e.clientX > b.left - pad && e.clientX < b.right + pad && e.clientY > b.top - pad && e.clientY < b.bottom + pad;
    pointer(coverView, e.clientX, e.clientY, inside);
  });
  bookBtn.addEventListener('pointerleave', () => pointer(coverView, 0, 0, false));
} else {
  const img = new Image();
  img.src = 'assets/img/oda-al-girasol-feliz.jpg';
  img.alt = '';
  img.style.cssText = 'position:absolute;left:13%;bottom:7.5%;width:74%;mix-blend-mode:multiply';
  coverCanvas.replaceWith(img);
}

// lector
const readerEl = $('#reader');
let reader = null;
let cameFromLanding = false;
const data = fetch('data/poems.json').then(r => r.json());

// preparar el libro mientras se ve la landing, para que abrirlo sea instantáneo
data.then(d => {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
  idle(async () => {
    await document.fonts.ready;
    if (!reader) reader = new Reader(readerEl, d);
    if (readerEl.hidden) reader.prebuild();
  }, { timeout: 2500 });
});

async function route() {
  const m = location.hash.match(/^#libro(?:\/([\w-]+))?/);
  if (m) {
    if (!reader) reader = new Reader(readerEl, await data);
    if (coverView) setVisible(coverView, false);
    reader.open(m[1]);
  } else if (reader && !readerEl.hidden) {
    reader.close();
    if (coverView) setTimeout(() => setVisible(coverView, true), 460);
  }
}

// Al abrir el libro, las pinceladas de la portada salen disparadas por toda la
// pantalla, se disuelven y debajo aparece el lector con la portada lista.
let opening = false;
async function openBook() {
  cameFromLanding = true;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!coverView || !coverView.set || calm || !reader) { location.hash = 'libro'; return; }
  if (opening) return;
  opening = true;
  const b = coverCanvas.getBoundingClientRect();
  const iw = b.width * 0.74;
  const rect = { x: b.left + b.width * 0.13, y: b.bottom - iw * 4 / 3 - b.height * 0.075, w: iw };
  const layer = document.createElement('canvas');
  layer.className = 'burst-layer';
  document.body.appendChild(layer);
  const fx = createView(layer, 'assets/splats/oda-al-girasol-feliz.bin', {
    getRect: () => rect, target: () => 1, initial: 1, maxDpr: 0.75, crisp: false,
  });
  await fx.ready;
  // El lector (ya preparado) aparece por arriba de la línea de pinceladas que baja;
  // por debajo sigue la landing hasta que la línea llega al borde inferior.
  readerEl.style.clipPath = 'inset(0 0 100% 0)';
  readerEl.style.opacity = '1';
  location.hash = 'libro';
  await wipe(fx, 1700, (t, y) => {
    readerEl.style.clipPath = `inset(0 0 ${Math.max(0, innerHeight - y)}px 0)`;
  });
  readerEl.style.clipPath = '';
  readerEl.style.opacity = '';
  destroyView(fx);
  layer.remove();
  opening = false;
}
$$('[data-open]').forEach(b => b.addEventListener('click', openBook));
$('[data-close]').addEventListener('click', () => {
  if (cameFromLanding) { cameFromLanding = false; history.back(); }
  else { history.pushState(null, '', location.pathname); route(); }
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !readerEl.hidden) $('[data-close]').click();
});
window.addEventListener('hashchange', route);
route();
