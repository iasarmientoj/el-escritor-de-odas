import { CONFIG, buyHref } from './config.js';
import { createView, setVisible, pointer, supported } from './splats.js';
import { Reader } from './book.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// enlaces configurables
$$('[data-buy]').forEach(a => {
  a.href = buyHref();
  if (CONFIG.buyUrl) { a.target = '_blank'; a.rel = 'noopener'; }
});
$$('[data-mail]').forEach(a => { a.href = `mailto:${CONFIG.email}`; a.textContent = CONFIG.email; });
$$('[data-tiktok]').forEach(a => {
  if (!CONFIG.tiktokUrl) return;
  a.href = CONFIG.tiktokUrl; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false;
});

// contacto por Gmail (abre la redacción de Gmail en una pestaña nueva)
$$('[data-gmail]').forEach(a => {
  const su = encodeURIComponent('Hola, Iván');
  a.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${CONFIG.email}&su=${su}`;
});

// biblioteca: el resto de la rejilla son libros por venir
const shelf = $('#shelf');
for (let i = 2; i <= 4; i++) {
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
      const iw = w * 0.84;
      return { x: w * 0.08, y: h - iw * 4 / 3 - w * 0.01, w: iw };
    },
    target: () => 1, initial: 0, speed: 0.75,
  });
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
  img.style.cssText = 'position:absolute;left:8%;bottom:1%;width:84%;mix-blend-mode:multiply';
  coverCanvas.replaceWith(img);
}

// lector
const readerEl = $('#reader');
let reader = null;
let cameFromLanding = false;
const data = fetch('data/poems.json').then(r => r.json());

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

$$('[data-open]').forEach(b => b.addEventListener('click', () => {
  cameFromLanding = true;
  location.hash = 'libro';
}));
$('[data-close]').addEventListener('click', () => {
  if (cameFromLanding) { cameFromLanding = false; history.back(); }
  else { history.pushState(null, '', location.pathname); route(); }
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !readerEl.hidden) $('[data-close]').click();
});
window.addEventListener('hashchange', route);
route();
