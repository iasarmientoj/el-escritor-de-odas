"""
Prepara los recursos de la web a partir de la carpeta de odas:

  - Convierte cada acuarela (.jpg) en un conjunto de "splats" gaussianos 2D
    (pinceladas elipticas) que, pintados en orden de grueso a fino, reproducen
    la imagen. Se guardan en web/assets/splats/<slug>.bin
  - Convierte los .wav a .mp3 ligeros (web/assets/audio/<slug>.mp3)
  - Genera miniaturas jpg (web/assets/img/<slug>.jpg)
  - Escribe web/data/poems.json con titulo, texto y rutas

Uso:  python web/tools/build.py            (todo)
      python web/tools/build.py --only feliz   (solo las que contengan 'feliz')
      python web/tools/build.py --preview      (guarda PNG de control en tools/preview)

Requiere: numpy, scipy, pillow y ffmpeg en el PATH.
"""
import argparse
import json
import re
import subprocess
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]          # carpeta de las odas
WEB = ROOT / "web"
OUT_SPLATS = WEB / "assets" / "splats"
OUT_AUDIO = WEB / "assets" / "audio"
OUT_IMG = WEB / "assets" / "img"
PREVIEW = WEB / "tools" / "preview"

# Orden de lectura en el libro (nombre del archivo sin extension)
ORDER = [
    "oda al girasol triste",
    "oda al girasol feliz",
    "oda con la lluvia",
    "oda al miladro de amor",
    "oda a la cura de la envidia",
    "oda a la imposibilidad de amar I",
    "oda a la imposibilidad de amar II",
    "oda a la imposibilidad de amar III",
]

W, H = 600, 800          # resolucion de ajuste (3:4)
# capas de grueso a fino: (sigma en px, paso de la rejilla, umbral de error)
LAYERS = [
    (22.0, 26, 0.000),
    (12.0, 13, 0.030),
    (6.5, 7, 0.040),
    (3.6, 4, 0.040),
    (2.0, 2.4, 0.045),
    (1.2, 1.5, 0.055),
]
MAX_SPLATS = 60000


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("miladro", "milagro")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def structure_orientation(lum, sigma):
    gx = ndimage.sobel(lum, axis=1)
    gy = ndimage.sobel(lum, axis=0)
    jxx = ndimage.gaussian_filter(gx * gx, sigma)
    jyy = ndimage.gaussian_filter(gy * gy, sigma)
    jxy = ndimage.gaussian_filter(gx * gy, sigma)
    # angulo del gradiente dominante; la pincelada va perpendicular (a lo largo del borde)
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy) + np.pi / 2
    tr = jxx + jyy + 1e-9
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / tr
    return theta, coh


def paint(canvas, x, y, sx, sy, th, rgb, a):
    """Compone una gaussiana eliptica sobre el lienzo (in-place)."""
    r = 3.0 * max(sx, sy)
    x0, x1 = int(max(0, x - r)), int(min(W, x + r + 1))
    y0, y1 = int(max(0, y - r)), int(min(H, y + r + 1))
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    dx, dy = xx - x, yy - y
    c, s = np.cos(th), np.sin(th)
    u = (dx * c + dy * s) / sx
    v = (-dx * s + dy * c) / sy
    w = (a * np.exp(-0.5 * (u * u + v * v)))[..., None]
    patch = canvas[y0:y1, x0:x1]
    patch *= 1 - w
    patch += w * rgb


def fit_image(path, rng):
    img = Image.open(path).convert("RGB").resize((W, H), Image.LANCZOS)
    tgt = np.asarray(img, dtype=np.float32) / 255.0
    # el papel de la foto no es blanco puro: normalizamos para que el fondo sea 1.0
    paper = np.percentile(tgt.reshape(-1, 3), 92, axis=0)
    tgt = np.clip(tgt / paper, 0, 1)
    lum = tgt @ np.array([0.299, 0.587, 0.114], np.float32)
    ink = 1.0 - tgt.min(axis=2)

    canvas = np.ones_like(tgt)
    splats = []
    for li, (sig, step, thr) in enumerate(LAYERS):
        blur = ndimage.gaussian_filter(tgt, (sig * 0.6, sig * 0.6, 0))
        ink_b = ndimage.gaussian_filter(ink, sig * 0.6)
        theta, coh = structure_orientation(lum, max(1.0, sig * 0.8))
        err = np.abs(canvas - tgt).mean(axis=2)
        err_b = ndimage.gaussian_filter(err, sig * 0.7)

        ys = np.arange(step / 2, H, step)
        xs = np.arange(step / 2, W, step)
        gx, gy = np.meshgrid(xs, ys)
        gx = gx + rng.uniform(-0.5, 0.5, gx.shape) * step
        gy = gy + rng.uniform(-0.5, 0.5, gy.shape) * step
        pts = np.stack([gx.ravel(), gy.ravel()], 1)
        pts = pts[(pts[:, 0] >= 0) & (pts[:, 0] < W) & (pts[:, 1] >= 0) & (pts[:, 1] < H)]
        rng.shuffle(pts)
        ix, iy = pts[:, 0].astype(int), pts[:, 1].astype(int)
        keep = (err_b[iy, ix] > thr) & (ink_b[iy, ix] > 0.035)
        pts = pts[keep]

        for x, y in pts:
            xi, yi = int(x), int(y)
            # re-evaluar el error local (el lienzo cambia mientras pintamos)
            if li > 0 and np.abs(canvas[yi, xi] - tgt[yi, xi]).mean() < thr * 0.8:
                continue
            k = float(coh[yi, xi])
            elong = 1.0 + 1.6 * k
            sx, sy = sig * np.sqrt(elong), sig / np.sqrt(elong)
            th = float(theta[yi, xi])
            col = blur[yi, xi]
            inkv = float(ink_b[yi, xi])
            a = float(np.clip(0.35 + inkv * 1.4, 0.35, 0.92))
            # color de pigmento: lo que hay que poner con opacidad a para llegar al objetivo
            pig = np.clip((col - (1 - a) * canvas[yi, xi]) / a, 0, 1)
            paint(canvas, x, y, sx, sy, th, pig, a)
            splats.append((x, y, sx, sy, th % np.pi, *pig, a, li))
            if len(splats) >= MAX_SPLATS:
                break
        if len(splats) >= MAX_SPLATS:
            break

    err = np.abs(canvas - tgt).mean()
    return np.array(splats, np.float32), canvas, tgt, err


def pack(sp):
    """12 bytes por splat: x,y (u16) sx,sy (u8 *8 en escala 1/2px) rot(u8) layer(u8)? -> ver formato."""
    n = len(sp)
    head = np.array([0x53504C54, n, W, H], np.uint32)  # 'SPLT'
    xy = np.empty((n, 2), np.uint16)
    xy[:, 0] = np.clip(sp[:, 0] / W * 65535, 0, 65535)
    xy[:, 1] = np.clip(sp[:, 1] / H * 65535, 0, 65535)
    ss = np.empty((n, 4), np.uint8)
    ss[:, 0] = np.clip(np.round(sp[:, 2] * 4), 1, 255)        # sx * 4
    ss[:, 1] = np.clip(np.round(sp[:, 3] * 4), 1, 255)        # sy * 4
    ss[:, 2] = np.clip(np.round(sp[:, 4] / np.pi * 255), 0, 255)
    ss[:, 3] = sp[:, 9]                                        # capa
    rgba = np.clip(np.round(sp[:, 5:9] * 255), 0, 255).astype(np.uint8)
    return head.tobytes() + xy.tobytes() + ss.tobytes() + rgba.tobytes()


def whiten(src):
    """Acuarela con el papel llevado a blanco puro y los bordes fundidos (600 x 800)."""
    a = np.asarray(Image.open(src).convert("RGB").resize((600, 800), Image.LANCZOS), dtype=np.float32) / 255.0
    paper = np.percentile(a.reshape(-1, 3), 90, axis=0)
    a = np.clip(a / paper, 0, 1)
    ink = 1 - a.min(axis=2, keepdims=True)
    k = np.clip((ink - 0.03) / 0.10, 0, 1)
    a = 1 - (1 - a) * k
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([xx, w - 1 - xx, yy, h - 1 - yy]).astype(np.float32)
    edge = np.clip(d / (min(h, w) * 0.07), 0, 1)[..., None]
    edge = edge * edge * (3 - 2 * edge)
    return 1 - (1 - a) * edge


def alpha_version(white):
    """La misma acuarela con fondo transparente (pigmento + alfa), para que la sombra
    siga el dibujo y no un rectángulo."""
    ink = 1 - white.min(axis=2)
    alpha = np.clip((ink - 0.07) * 2.8, 0, 1)   # sin los lavados más pálidos (evita un halo claro)
    pig = np.clip((white - (1 - alpha[..., None])) / np.maximum(alpha[..., None], 1e-3), 0, 1)
    rgba = np.dstack([pig, alpha])
    return Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")


def profile(white, rows=48):
    """Silueta por filas: [x mínimo, x máximo] de la tinta (0..1), o [-1, -1] si la fila está vacía.
    Sirve para que el texto rodee el dibujo."""
    ink = 1 - white.min(axis=2)
    mask = ink > 0.05   # incluye trazos tenues (pelo, salpicaduras, lluvia)
    # quitar salpicaduras sueltas: quedarse con las manchas grandes del dibujo
    mask = ndimage.binary_opening(mask, iterations=1)
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        mask = np.isin(lab, 1 + np.where(sizes >= max(120, sizes.max() * 0.004))[0])
    mask = ndimage.binary_dilation(mask, iterations=8)
    h, w = mask.shape
    out = []
    for r in range(rows):
        band = mask[int(r * h / rows):int((r + 1) * h / rows)]
        cols = np.where(band.any(axis=0))[0]
        out.append([-1, -1] if len(cols) < 3 else [cols[0] / w, cols[-1] / w])
    # ensanchar un poco hacia arriba y abajo para que el texto no roce las puntas
    wide = []
    for r in range(rows):
        near = [out[q] for q in range(max(0, r - 2), min(rows, r + 3)) if out[q][0] >= 0]
        wide.append([-1, -1] if not near else [round(min(a for a, _ in near), 3), round(max(b for _, b in near), 3)])
    return wide


def first_line_and_body(md):
    lines = md.replace("\r\n", "\n").strip().split("\n")
    title = lines[0].strip().lstrip("#").strip()
    body = "\n".join(lines[1:]).strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return title, body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--skip-audio", action="store_true")
    ap.add_argument("--datos", action="store_true",
                    help="solo imágenes, siluetas y poems.json (sin splats ni audio)")
    args = ap.parse_args()
    for d in (OUT_SPLATS, OUT_AUDIO, OUT_IMG, WEB / "data"):
        d.mkdir(parents=True, exist_ok=True)

    poems = []
    for i, name in enumerate(ORDER):
        slug = slugify(name)
        title, body = first_line_and_body((ROOT / f"{name}.md").read_text(encoding="utf-8"))
        src = ROOT / f"{name}.jpg"
        white = whiten(src)
        poems.append({
            "slug": slug, "title": title, "text": body,
            "audio": f"assets/audio/{slug}.mp3",
            "splats": f"assets/splats/{slug}.bin",
            "image": f"assets/img/{slug}.jpg",
            "imageAlpha": f"assets/img/{slug}-alfa.webp",
            "profile": profile(white),
        })
        if args.only and args.only not in name:
            continue
        print(f"[{i + 1}/{len(ORDER)}] {title}")
        Image.fromarray((white * 255 + 0.5).astype(np.uint8)).save(
            OUT_IMG / f"{slug}.jpg", quality=84, optimize=True, progressive=True)
        alpha_version(white).save(OUT_IMG / f"{slug}-alfa.webp", quality=82, method=6)
        if args.datos:
            continue

        rng = np.random.default_rng(7 + i)
        sp, canvas, tgt, err = fit_image(src, rng)
        (OUT_SPLATS / f"{slug}.bin").write_bytes(pack(sp))
        print(f"    {len(sp)} splats, error medio {err:.4f}")
        if args.preview:
            PREVIEW.mkdir(exist_ok=True)
            both = np.concatenate([tgt, canvas], 1)
            Image.fromarray((both * 255).astype(np.uint8)).save(PREVIEW / f"{slug}.png")

        if not args.skip_audio:
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(ROOT / f"{name}.wav"),
                "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k",
                str(OUT_AUDIO / f"{slug}.mp3")], check=True)

    (WEB / "data" / "poems.json").write_text(
        json.dumps({"book": {
            "title": "El girasol que cobró consciencia de sol",
            "author": "Iván Sarmiento",
            "pen": "El escritor de odas",
        }, "poems": poems}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("listo")


if __name__ == "__main__":
    main()
