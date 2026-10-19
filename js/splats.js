// Motor de splats gaussianos 2D.
// Un único contexto WebGL2 (fuera del DOM) pinta cada "vista" y luego se copia
// a un <canvas> 2D de la página. Así podemos tener muchas páginas con imagen
// sin agotar el límite de contextos WebGL del navegador.

const VERT = `#version 300 es
in vec2 aCorner;
in vec2 aHome;
in vec3 aShape;   // sx, sy (unidades de imagen), rotación
in vec4 aFly;     // inicio x, inicio y, llegada, semilla
in vec4 aColor;
in vec2 aOff;
uniform vec2 uView;
uniform vec3 uRect;   // x, y, px por unidad (ancho de la imagen = 1)
uniform float uProg, uTime, uGhost, uAlpha, uDpr;
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
  float s = uRect.z;
  vec2 sz = aShape.xy * s;
  float minS = 0.55 * uDpr;
  float aa = 1.0;
  float m = min(sz.x, sz.y);
  if (m < minS) { aa = max(m / minS, 0.25); sz = max(sz, vec2(minS)); }
  sz *= mix(1.15, 1.0, k);
  float c = cos(aShape.z), sn = sin(aShape.z);
  vec2 q = aCorner * 3.0 * sz;
  vec2 rq = vec2(q.x * c - q.y * sn, q.x * sn + q.y * c);
  vec2 px = uRect.xy + p * s + rq;
  gl_Position = vec4(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, 0.0, 1.0);
  vUV = aCorner * 3.0;
  float vis = uGhost > 0.5 ? uAlpha : smoothstep(0.0, 0.5, e) * mix(0.35, 1.0, k * k) * uAlpha;
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
    for (const u of ['uView', 'uRect', 'uProg', 'uTime', 'uGhost', 'uAlpha', 'uDpr']) this.loc[u] = gl.getUniformLocation(p, u);
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
    const ghost = view.ghost * (1 - Math.min(1, view.p * 1.6));
    if (ghost > 0.002) {
      gl.uniform1f(L.uGhost, 1); gl.uniform1f(L.uProg, 1); gl.uniform1f(L.uAlpha, ghost);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.n);
    }
    if (view.p > 0.001) {
      gl.uniform1f(L.uGhost, 0); gl.uniform1f(L.uProg, view.p); gl.uniform1f(L.uAlpha, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, set.n);
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
    speed: opts.speed ?? 2.2, visible: false, dpr: 1, rect: { x: 0, y: 0, w: 1 },
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
  const x = (clientX - b.left - r.x) / r.w, y = (clientY - b.top - r.y) / r.w;
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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
