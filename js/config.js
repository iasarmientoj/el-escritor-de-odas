// Ajustes editables del sitio. Cambia aquí los enlaces sin tocar el resto del código.
export const CONFIG = {
  email: 'iasarmientoj@gmail.com',

  // Enlace de compra (Hotmart, Payhip, Amazon, etc.). Si se deja vacío,
  // el botón "Comprar" abre un correo para pedir el libro.
  buyUrl: '',

  // Perfil de TikTok. Vacío = se oculta el botón.
  tiktokUrl: 'https://www.tiktok.com/@elescritordeodas',

  // Al terminar el audio de una oda, pasar sola a la siguiente y seguir leyendo.
  autoContinue: true,
};

export function buyHref() {
  if (CONFIG.buyUrl) return CONFIG.buyUrl;
  const subject = encodeURIComponent('Quiero el libro «El girasol que cobró consciencia de sol»');
  const body = encodeURIComponent('Hola, Iván:\n\nMe gustaría comprar el libro «El girasol que cobró consciencia de sol».\n\n');
  return `mailto:${CONFIG.email}?subject=${subject}&body=${body}`;
}
