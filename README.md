# El escritor de odas: web del libro «Un girasol cobró consciencia»

Sitio estático (HTML + JS, sin compilación) listo para GitHub Pages.

## Editar
- **Enlaces** (compra, TikTok, correo): `js/config.js`
- **Foto del autor**: guarda una foto cuadrada como `assets/autor.jpg` (mín. 600×600).
- **Textos de la landing y "Sobre el autor"**: `index.html`
- **Poemas, imágenes o audios nuevos**: ponlos en la carpeta de las odas (`.md`, `.jpg`, `.wav`
  con el mismo nombre), añade el nombre a `ORDER` en `tools/build.py` y ejecuta:

  ```
  python tools/build.py
  ```
  Esto regenera los splats (`assets/splats`), los mp3, las miniaturas y `data/poems.json`.

## Probar en local
```
python -m http.server 8417
```
y abre http://localhost:8417

## Enlaces directos para TikTok
Cada oda tiene su propio enlace, que abre el libro en esa página:
`https://iasarmientoj.github.io/el-escritor-de-odas/#libro/oda-al-girasol-triste`

## Publicar en GitHub Pages
1. Crea un repositorio y sube el contenido de esta carpeta `web/`.
2. En Settings → Pages: "Deploy from a branch", rama `main`, carpeta `/ (root)`.
