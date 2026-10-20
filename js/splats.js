// Motor de splats gaussianos 2D.
// Un único contexto WebGL2 (fuera del DOM) pinta cada "vista" y luego se copia
// a un <canvas> 2D de la página. Así podemos tener muchas páginas con imagen
// sin agotar el límite de contextos WebGL del navegador.

const VERT = `#version 300 es
in vec2 aCorner;
in vec2 aHome;
in vec3 aShape;   // sx, sy (unidades de imagen), rotacion
in vec4 aFly;     // inicio x, inicio y, llegada, semilla
in vec4 aColor;
in vec2 aOff;
uniform vec2 uView;
uniform vec3 uRect;   // x, y, px por unidad (ancho de la imagen = 1)
uniform float uProg, uTime, uGhost, uAlpha, uDpr;
uniform float uBurst, uSpread, uFade;   // explosion al abrir el libro (0..1), alcance en unidades de imagen y desvanecido final
uniform float uKeep;   // cuantas pinceladas (las mas grandes) siguen visibles al final de la explosion
uniform float uWipe;   // cortina: linea de pinceladas que baja desde el borde superior (0..1)
uniform float uCrisp;  // 1 = en reposo no se ven (se ve la imagen original nitida); aparecen al moverlas
uniform vec2 uCenter;
out vec2 vUV;
out vec4 vCol;

void main() {
  float seed = aFly.w;
  float e = uGhost > 0.5 ? 1.0 : clamp((uProg - aFly.z) / 0.15, 0.0, 1.0);
  float k = e * e * (3.0 - 2.0 * e);
  vec2 dir = aHome - aFly.xy;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 p = mix(aFly.xy, aHome, k) + perp * sin(k * 3.14159) * (seed - 0.5) * 0.7;
  p += aOff * k;
  // explosion: cada pincelada sale disparada desde el centro de la imagen y se disuelve
  // Rafaga: cada pincelada sale en su momento (no todas a la vez), viaja hasta el
  // borde de la pantalla en su direccion (el frente toma la forma de la pantalla,
  // no de un circulo) y ondula como un petalo en el viento.
  float delay = 0.28 * fract(seed * 5.13);
  float tb = clamp((uBurst - delay) / (1.0 - delay), 0.0, 1.0);
  float eb = 1.0 - pow(1.0 - tb, 2.0);
  if (uBurst > 0.0) {
    vec2 d = aHome - uCenter + (vec2(fract(seed * 13.7), fract(seed * 7.3)) - 0.5) * 0.12;
    vec2 bd = normalize(d + 1e-4);
    // distancia (en unidades de imagen) desde el centro hasta el borde de la pantalla
    vec2 cp = uRect.xy + uCenter * uRect.z;
    float ex = bd.x > 0.0 ? (uView.x - cp.x) / bd.x : -cp.x / min(bd.x, -1e-4);
    float ey = bd.y > 0.0 ? (uView.y - cp.y) / bd.y : -cp.y / min(bd.y, -1e-4);
    float edge = min(ex, ey) / uRect.z;
    float reach = edge * (0.3 + 0.95 * fract(seed * 91.7));
    vec2 side = vec2(-bd.y, bd.x);
    float wave = sin(eb * 7.0 + seed * 23.0) * 0.18 * reach * eb * (1.0 - eb) * 2.0;
    p += bd * eb * reach + side * wave;
    p.y -= eb * eb * 0.12 * edge;   // leve subida, como petalos que se lleva el aire
  }
  if (uWipe > 0.0) {
    // cortina: las pinceladas forman una franja ondulada a lo ancho de la pantalla que baja
    float H = uView.y, W = uView.x;
    float band = 0.045 * H;
    float lx = fract(seed * 31.1) * (W + 0.1 * W) - 0.05 * W;
    float ly = uWipe * (H + 2.0 * band) - band
             + sin(lx / W * 9.0 + uWipe * 7.0) * 0.014 * H
             + (fract(seed * 47.9) - 0.5) * band * 0.8
             - pow(fract(seed * 71.3), 8.0) * band * 2.0;   // algunas gotas se quedan atras
    // movimiento propio de cada pincelada dentro de la franja (amontonadas pero vivas)
    float wob = 0.018 * H;
    lx += sin(uTime * 2.3 + seed * 41.0) * wob * 1.6 + sin(uWipe * 18.0 + seed * 9.0) * wob;
    ly += cos(uTime * 2.9 + seed * 27.0) * wob + sin(uWipe * 23.0 + seed * 13.0) * wob * 0.6;
    p = (vec2(lx, ly) - uRect.xy) / uRect.z;
  }
  float s = uRect.z;
  vec2 sz = aShape.xy * s;
  float minS = 0.55 * uDpr;
  float aa = 1.0;
  float m = min(sz.x, sz.y);
  if (m < minS) { aa = max(m / minS, 0.25); sz = max(sz, vec2(minS)); }
  // al explotar, las pinceladas crecen hasta cubrir la pantalla entera
  sz *= mix(1.15, 1.0, k) * (1.0 + eb * 26.0) * (uWipe > 0.0 ? 1.25 : 1.0);
  float c = cos(aShape.z), sn = sin(aShape.z);
  vec2 q = aCorner * 3.0 * sz;
  vec2 rq = vec2(q.x * c - q.y * sn, q.x * sn + q.y * c);
  vec2 px = uRect.xy + p * s + rq;
  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);
  vUV = aCorner * 3.0;
  float vis = uGhost > 0.5 ? uAlpha : smoothstep(0.0, 0.5, e) * mix(0.35, 1.0, k * k) * uAlpha;
  // las pinceladas finas se apagan pronto; las grandes cubren la pantalla hasta el desvanecido
  if (float(gl_InstanceID) >= uKeep) vis *= 1.0 - smoothstep(0.15, 0.55, uBurst);
  vis *= 1.0 - uFade;
  vis *= 1.0 - smoothstep(0.86, 1.0, uWipe);
  if (uCrisp > 0.5) vis *= smoothstep(0.004, 0.03, length(aOff));
  // las pinceladas casi blancas no aportan dibujo y velan el papel: se atenuan
  float inkc = 1.0 - min(min(aColor.r, aColor.g), aColor.b);
  vis *= smoothstep(0.05, 0.2, inkc);
  vCol = vec4(aColor.rgb, aColor.a * aa * vis);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vCol;
out vec4 o;
void main() {
  float r2 = dot(vUV, vUV);
  if (r2 > 9.0) discard;
  float a = vCol.a * exp(-0.5 * r2);
  o = vec4(vCol.rgb * a, a);
}`;

const KEEP = 2600;   // pinceladas gruesas (van primero en el archivo)
const LAYER_BASE = [0.0, 0.08, 0.2, 0.32, 0.45, 0.55];

// ---------------------------------------------------------------- carga
const cache = new Map();
export function loadSplats(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => {
    if (!r.ok) throw new Error(url);
    return r.arrayBuffer();
  }).then(parse));
  return cache.get(url);
}

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function parse(buf) {
  const head = new Uint32Array(buf, 0, 4);
  const n = head[1], W = head[2], H = head[3];
  const aspect = H / W;
  const xy = new Uint16Array(buf, 16, n * 2);
  const ss = new Uint8Array(buf, 16 + n * 4, n * 4);
  const rgba = new Uint8Array(buf, 16 + n * 8, n * 4);
  const R = rand(n * 7 + W);

  // atributos estáticos: home(2) shape(3) fly(4) = 9 floats
  const stat = new Float32Array(n * 9);
  const hx = new Float32Array(n), hy = new Float32Array(n), mass = new Float32Array(n);
  const arrival = new Float32Array(n);
  const cx = 0.5, cy = aspect / 2;
  for (let i = 0; i < n; i++) {
    const x = xy[i * 2] / 65535, y = xy[i * 2 + 1] / 65535 * aspect;
    const sx = ss[i * 4] / 4 / W, sy = ss[i * 4 + 1] / 4 / W;
    const rot = ss[i * 4 + 2] / 255 * Math.PI;
    const layer = ss[i * 4 + 3];
    const ang = R() * Math.PI * 2, dist = 1.15 + R() * 1.1;
    const a = (LAYER_BASE[layer] ?? 0.55) + R() * 0.25;
    const o = i * 9;
    stat[o] = x; stat[o + 1] = y;
    stat[o + 2] = sx; stat[o + 3] = sy; stat[o + 4] = rot;
    stat[o + 5] = cx + Math.cos(ang) * dist; stat[o + 6] = cy + Math.sin(ang) * dist;
    stat[o + 7] = a; stat[o + 8] = R();
    hx[i] = x; hy[i] = y; arrival[i] = a;
    // las pinceladas grandes pesan más y se mueven menos
    mass[i] = 1 / (1 + Math.max(sx, sy) * 60);
  }
  return {
    n, aspect, stat, rgba: new Uint8Array(rgba), hx, hy, mass, arrival,
    offx: new Float32Array(n), offy: new Float32Array(n),
    velx: new Float32Array(n), vely: new Float32Array(n),
    off: new Float32Array(n * 2), awake: false, gpu: null,
  };
}

// ---------------------------------------------------------------- física
function step(set, mouse, prog, dt) {
  const { n, hx, hy, mass, arrival, offx, offy, velx, vely } = set;
  const f = Math.min(dt * 60, 3);
  const k = 0.010 * f, damp = Math.pow(0.9, f);
  const R = 0.13, R2 = R * R;
  const active = mouse && mouse.active;
  if (!active && !set.awake) return false;
  let energy = 0;
  const mx = active ? mouse.x : 0, my = active ? mouse.y : 0;
  const mvx = active ? mouse.vx : 0, mvy = active ? mouse.vy : 0;
  const push = active ? 0.008 * f * (0.35 + Math.min(1, Math.hypot(mvx, mvy) * 40)) : 0;
  for (let i = 0; i < n; i++) {
    let ox = offx[i], oy = offy[i], vx = velx[i], vy = vely[i];
    if (active && prog > arrival[i] + 0.15) {
      const px = hx[i] + ox - mx, py = hy[i] + oy - my;
      const d2 = px * px + py * py;
      if (d2 < R2) {
        const d = Math.sqrt(d2) + 1e-4;
        let w = 1 - d / R; w *= w * mass[i];
        vx += (px / d) * w * push + mvx * w * 0.4;
        vy += (py / d) * w * push + mvy * w * 0.4;
      }
    }
    vx = (vx - ox * k) * damp;
    vy = (vy - oy * k) * damp;
    ox += vx * f; oy += vy * f;
    offx[i] = ox; offy[i] = oy; velx[i] = vx; vely[i] = vy;
    energy += Math.abs(ox) + Math.abs(oy) + Math.abs(vx) + Math.abs(vy);
  }
  set.awake = energy > 1e-4 * n * 0.01 || active;
  if (!set.awake) { offx.fill(0); offy.fill(0); velx.fill(0); vely.fill(0); }
  const off = set.off;
  for (let i = 0; i < n; i++) { off[i * 2] = offx[i]; off[i * 2 + 1] = offy[i]; }
  return true;
}

// ---------------------------------------------------------------- render
class Renderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    this.prog = p;
    this.loc = {};
    for (const a of ['aCorner', 'aHome', 'aShape', 'aFly', 'aColor', 'aOff']) this.loc[a] = gl.getAttribLocation(p, a);
    for (const u of ['uView', 'uRect', 'uProg', 'uTime', 'uGhost', 'uAlpha', 'uDpr', 'uBurst', 'uSpread', 'uCenter', 'uFade', 'uKeep', 'uWipe', 'uCrisp']) this.loc[u] = gl.getUniformLocation(p, u);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.w = 0; this.h = 0;
  }

  ensure(w, h) {
    if (w > this.w || h > this.h) {
      this.w = Math.max(w, this.w); this.h = Math.max(h, this.h);
      this.canvas.width = this.w; this.canvas.height = this.h;
    }
  }

  upload(set) {
    const gl = this.gl, L = this.loc;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(L.aCorner);
    gl.vertexAttribPointer(L.aCorner, 2, gl.FLOAT, false, 0, 0);

    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, set.stat, gl.STATIC_DRAW);
    const attr = (loc, size, off) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(L.aHome, 2, 0); attr(L.aShape, 3, 8); attr(L.aFly, 4, 20);

    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, set.rgba, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(L.aColor);
    gl.vertexAttribPointer(L.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.vertexAttribDivisor(L.aColor, 1);

    const ob = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ob);
    gl.bufferData(gl.ARRAY_BUFFER, set.off, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(L.aOff);
    gl.vertexAttribPointer(L.aOff, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(L.aOff, 1);
    gl.bindVertexArray(null);
    set.gpu = { vao, ob };
  }

  draw(view, time) {
    const gl = this.gl, L = this.loc, set = view.set;
    if (!set.gpu) this.upload(set);
    const cw = view.canvas.width, ch = view.canvas.height;
    this.ensure(cw, ch);
    gl.viewport(0, this.h - ch, cw, ch);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, this.h - ch, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(set.gpu.vao);
    if (set.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, set.gpu.ob);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, set.off);
      set.dirty = false;
    }
    const r = view.rect, d = view.dpr;
    gl.uniform2f(L.uView, cw, ch);
    gl.uniform3f(L.uRect, r.x * d, r.y * d, r.w * d);
    gl.uniform1f(L.uTime, time);
    gl.uniform1f(L.uDpr, d);
    gl.uniform1f(L.uBurst, view.burst || 0);
    gl.uniform1f(L.uFade, view.fade || 0);
    gl.uniform1f(L.uKeep, KEEP);
    gl.uniform1f(L.uWipe, view.wipe || 0);
    gl.uniform1f(L.uCrisp, view.crisp ? 1 : 0);
    gl.uniform1f(L.uSpread, Math.hypot(cw, ch) / Math.max(1, r.w * d));
    gl.uniform2f(L.uCenter, 0.5, set.aspect / 2);
    const ghost = view.ghost * (1 - Math.min(1, view.p * 1.6));
    if (ghost > 0.002) {
      gl.uniform1f(L.uGhost, 1); gl.uniform1f(L.uProg, 1); gl.uniform1f(L.uAlpha, ghost);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.n);
    }
    if (view.p > 0.001) {
      gl.uniform1f(L.uGhost, 0); gl.uniform1f(L.uProg, view.p); gl.uniform1f(L.uAlpha, 1);
      const count = (view.burst || 0) > 0.55 || (view.wipe || 0) > 0 ? Math.min(set.n, KEEP) : set.n;
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    gl.bindVertexArray(null);
    const ctx = view.ctx;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(this.canvas, 0, 0, cw, ch, 0, 0, cw, ch);
  }
}

// ---------------------------------------------------------------- vistas
let renderer = null;
const views = new Set();
let last = 0, running = false;
const t0 = performance.now();

export const supported = (() => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
})();

/**
 * Crea una vista: un canvas que muestra un conjunto de splats.
 * opts.getRect() -> {x, y, w} en px CSS dentro del canvas (w = ancho de la imagen)
 * opts.target()  -> progreso objetivo 0..1 (1 = imagen completa)
 * opts.ghost     -> opacidad de la "sombra" previa (0..1)
 */
export function createView(canvas, url, opts = {}) {
  const view = {
    canvas, ctx: canvas.getContext('2d'), set: null, p: opts.initial ?? 0,
    ghost: opts.ghost ?? 0, getRect: opts.getRect, target: opts.target || (() => 1),
    speed: opts.speed ?? 2.2, visible: false, dpr: 1, rect: { x: 0, y: 0, w: 1 }, maxDpr: opts.maxDpr, burst: 0, wipe: 0, crisp: opts.crisp ?? true,
    mouse: { x: 0, y: 0, vx: 0, vy: 0, active: false, lastT: 0 },
    dirtyFrame: true, ready: null,
  };
  // al terminar de cargar, reanudar el bucle (puede haberse detenido mientras no había nada que pintar)
  view.ready = loadSplats(url).then(set => { view.set = set; view.dirtyFrame = true; ensureLoop(); return set; });
  views.add(view);
  ensureLoop();
  return view;
}

export function destroyView(view) { views.delete(view); }

export function setVisible(view, v) {
  view.visible = v;
  if (v) { view.dirtyFrame = true; ensureLoop(); }
}

/** Actualiza la posición del puntero (coordenadas de cliente). */
export function pointer(view, clientX, clientY, inside = true) {
  const m = view.mouse;
  if (!inside) { m.active = false; return; }
  const b = view.canvas.getBoundingClientRect();
  const r = view.rect;
  // el canvas puede estar escalado (portada flotando, libro en 3D): corregir la escala
  const sx = b.width / (view.canvas.offsetWidth || b.width);
  const sy = b.height / (view.canvas.offsetHeight || b.height);
  const x = ((clientX - b.left) / sx - r.x) / r.w, y = ((clientY - b.top) / sy - r.y) / r.w;
  const now = performance.now();
  if (m.active && now - m.lastT < 120) {
    const k = Math.min(1, 16 / Math.max(1, now - m.lastT));
    m.vx = m.vx * 0.5 + (x - m.x) * k * 0.5;
    m.vy = m.vy * 0.5 + (y - m.y) * k * 0.5;
  } else { m.vx = 0; m.vy = 0; }
  m.x = x; m.y = y; m.lastT = now; m.active = true;
  ensureLoop();
}

function layout(view) {
  const c = view.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, view.maxDpr || 2);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (!w || !h) return false;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; view.dirtyFrame = true; }
  view.dpr = dpr;
  const r = view.getRect ? view.getRect() : { x: 0, y: 0, w: c.clientWidth };
  if (r.x !== view.rect.x || r.y !== view.rect.y || r.w !== view.rect.w) view.dirtyFrame = true;
  view.rect = r;
  return true;
}

function ensureLoop() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = (now - t0) / 1000;
  let any = false;
  for (const v of views) {
    if (!v.visible || !v.set) continue;
    any = true;
    if (!renderer) renderer = new Renderer();
    if (!renderer.gl) return;
    if (!layout(v)) continue;
    const tgt = v.target();
    const dp = tgt - v.p;
    if (Math.abs(dp) > 0.0005) v.p += dp * Math.min(1, dt * v.speed) + Math.sign(dp) * Math.min(Math.abs(dp), dt * 0.02);
    else v.p = tgt;
    if (v.mouse.active && now - v.mouse.lastT > 90) { v.mouse.vx *= 0.8; v.mouse.vy *= 0.8; }
    if (step(v.set, v.mouse, v.p, dt)) v.set.dirty = true;
    renderer.draw(v, time);
  }
  if (any) requestAnimationFrame(frame);
  else running = false;
}

/**
 * Explosión al abrir el libro, en dos tiempos:
 *   burst(view)  -> las pinceladas salen disparadas y crecen hasta cubrir la pantalla
 *   fadeOut(view) -> cuando lo de debajo ya está listo, se desvanecen
 */
function animate(view, key, ms) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = now => {
      view[key] = Math.min(1, (now - t0) / ms);
      if (view[key] < 1) requestAnimationFrame(tick); else resolve();
    };
    setVisible(view, true);
    requestAnimationFrame(tick);
  });
}
export const burst = (view, ms = 900) => animate(view, 'burst', ms);
export const fadeOut = (view, ms = 800) => animate(view, 'fade', ms);

/**
 * Transición de un solo movimiento: explotan, cubren la pantalla y se desvanecen
 * sin detenerse. onCovered se llama cuando la pantalla ya está cubierta.
 */
/**
 * Cortina: una linea de pinceladas baja desde el borde superior hasta el inferior.
 * onFrame(t, y) recibe el progreso y la altura de la linea en px CSS.
 */
export function wipe(view, ms = 1700, onFrame) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = now => {
      const x = Math.min(1, (now - t0) / ms);
      const t = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;   // suave al entrar y al salir
      view.wipe = Math.max(0.0001, t);
      const H = innerHeight, band = H * 0.045;
      onFrame && onFrame(t, t * (H + 2 * band) - band);
      if (x < 1) requestAnimationFrame(tick); else resolve();
    };
    setVisible(view, true);
    requestAnimationFrame(tick);
  });
}

export function transition(view, ms = 2100, onCovered) {
  return new Promise(resolve => {
    const t0 = performance.now();
    let covered = false;
    const tick = now => {
      const t = Math.min(1, (now - t0) / ms);
      view.burst = t;
      const f = Math.max(0, (t - 0.5) / 0.5);
      view.fade = f * f * (3 - 2 * f);
      if (!covered && t >= 0.32) { covered = true; onCovered && onCovered(); }
      if (t < 1) requestAnimationFrame(tick); else resolve();
    };
    setVisible(view, true);
    requestAnimationFrame(tick);
  });
}
