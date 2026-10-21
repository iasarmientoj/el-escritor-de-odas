// Eventos propios para Google Analytics (la etiqueta está en index.html).
// Se ven en Analytics › Informes › Interacción › Eventos:
//   abrir_libro    alguien abre el lector desde la portada
//   ver_oda        llega a una oda en el lector            (oda = título)
//   escuchar_oda   le da play al audio de una oda          (oda = título)
//   oda_completa   escucha el audio de una oda hasta el final
//   clic_comprar   pulsa un botón de comprar               (lugar = portada | lector)
//   clic_tiktok    pulsa el enlace a TikTok
// Si un bloqueador de anuncios impide cargar Analytics, simplemente no se envía nada.

export function evento(nombre, datos = {}) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', nombre, datos);
  } catch { /* nunca romper la página por la analítica */ }
}

// cada oda cuenta una sola vez por visita, aunque se vuelva a ella
const vistas = new Set();
export function eventoUnaVez(nombre, oda) {
  const clave = `${nombre}:${oda}`;
  if (vistas.has(clave)) return;
  vistas.add(clave);
  evento(nombre, { oda });
}
