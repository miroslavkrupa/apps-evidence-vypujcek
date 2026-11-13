// Tisk štítků knih a kartiček pracovníků s QR kódy.

import { el } from './util.js';
import { nastaveni } from './api.js';

/** Formáty samolepicích etiket A4 (rozměry v mm). */
export const FORMATY_STITKU = [
  { id: '70x37', nazev: '70 × 37 mm – 24 ks na A4 (3 × 8)', sloupce: 3, radky: 8, w: 70, h: 37, horni: 0.5, levy: 0 },
  { id: '70x42', nazev: '70 × 42,3 mm – 21 ks na A4 (3 × 7)', sloupce: 3, radky: 7, w: 70, h: 42.3, horni: 0.35, levy: 0 },
  { id: '70x36', nazev: '70 × 36 mm – 24 ks na A4 (3 × 8, okraj 4,5 mm)', sloupce: 3, radky: 8, w: 70, h: 36, horni: 4.5, levy: 0 },
  { id: '52x30', nazev: '52,5 × 29,7 mm – 40 ks na A4 (4 × 10)', sloupce: 4, radky: 10, w: 52.5, h: 29.7, horni: 0, levy: 0 },
  { id: '105x48', nazev: '105 × 48 mm – 12 ks na A4 (2 × 6)', sloupce: 2, radky: 6, w: 105, h: 48, horni: 4.5, levy: 0 },
];

/** Kartičky pracovníků: 85 × 54 mm, 10 ks na A4 (2 × 5), s čarou pro stříhání. */
const KARTY = { sloupce: 2, radky: 5, w: 85, h: 54, horni: 13.5, levy: 20 };

/** Adresa aplikace vkládaná do QR kódů. */
export function adresaAplikace() {
  if (nastaveni.APP_URL) return nastaveni.APP_URL.replace(/#.*$/, '');
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function obsahQr(typ, id) {
  return `${adresaAplikace()}#${typ === 'kniha' ? 'k' : 'p'}=${id}`;
}

/** Vytvoří SVG s QR kódem (jedna cesta, bez okrajů – okraj řeší rozvržení). */
export function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const okraj = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + okraj} ${r + okraj}h1v1h-1z`;
    }
  }
  const vel = n + okraj * 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${vel} ${vel}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `<rect width="${vel}" height="${vel}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}

function strany(polozky, naStranu, preskocit) {
  const pozice = [];
  for (let i = 0; i < preskocit; i++) pozice.push(null);
  pozice.push(...polozky);
  const vysledek = [];
  for (let i = 0; i < pozice.length; i += naStranu) vysledek.push(pozice.slice(i, i + naStranu));
  return vysledek;
}

/**
 * Sestaví stránky se štítky knih.
 * @param {Array} knihy
 * @param {{format: string, preskocit?: number, posunX?: number, posunY?: number}} volby
 */
export function stranyStitku(knihy, volby) {
  const f = FORMATY_STITKU.find((x) => x.id === volby.format) || FORMATY_STITKU[0];
  const naStranu = f.sloupce * f.radky;
  const maly = f.h < 33;
  const qrVel = Math.min(f.h - 4, f.w * 0.45);
  return strany(knihy, naStranu, Math.max(0, Number(volby.preskocit) || 0)).map((stranka) => {
    const s = el('div', { class: 'strana' });
    stranka.forEach((k, i) => {
      if (!k) return;
      const sl = i % f.sloupce;
      const ra = Math.floor(i / f.sloupce);
      const stitek = el('div', { class: `stitek-knihy${maly ? ' maly' : ''}` },
        el('div', { class: 'qr' }, qrSvg(obsahQr('kniha', k.id))),
        el('div', { class: 'info' },
          el('div', { class: 'oddeleni' }, nastaveni.ODDELENI),
          el('div', { class: 'id' }, k.id),
          el('div', { class: 'nazev' }, k.nazev)));
      Object.assign(stitek.style, {
        left: `${f.levy + sl * f.w + (Number(volby.posunX) || 0)}mm`,
        top: `${f.horni + ra * f.h + (Number(volby.posunY) || 0)}mm`,
        width: `${f.w}mm`,
        height: `${f.h}mm`,
      });
      stitek.firstChild.style.width = `${qrVel}mm`;
      stitek.firstChild.style.height = `${qrVel}mm`;
      s.append(stitek);
    });
    return s;
  });
}

/** Sestaví stránky s kartičkami pracovníků. */
export function stranyKarticek(pracovnici, volby = {}) {
  const f = KARTY;
  return strany(pracovnici, f.sloupce * f.radky, Math.max(0, Number(volby.preskocit) || 0)).map((stranka) => {
    const s = el('div', { class: 'strana' });
    stranka.forEach((p, i) => {
      if (!p) return;
      const sl = i % f.sloupce;
      const ra = Math.floor(i / f.sloupce);
      const k = el('div', { class: 'karticka' },
        el('div', { class: 'pruh' }, `Knihovna – ${nastaveni.ODDELENI}`),
        el('div', { class: 'telo' },
          el('div', { class: 'qr' }, qrSvg(obsahQr('pracovnik', p.id))),
          el('div', {},
            el('div', { class: 'jmeno' }, p.jmeno),
            p.funkce ? el('div', { class: 'funkce' }, p.funkce) : null,
            el('div', { class: 'id' }, p.id),
            el('div', { class: 'pokyn' }, 'Při výpůjčce naskenujte tento kód.'))));
      Object.assign(k.style, {
        left: `${f.levy + sl * f.w + (Number(volby.posunX) || 0)}mm`,
        top: `${f.horni + ra * f.h + (Number(volby.posunY) || 0)}mm`,
      });
      s.append(k);
    });
    return s;
  });
}

/** Vloží stránky do tiskové oblasti a otevře dialog tisku prohlížeče. */
export function vytiskni(stranky) {
  const oblast = document.getElementById('tisk');
  oblast.replaceChildren(...stranky);
  const uklid = () => {
    oblast.replaceChildren();
    window.removeEventListener('afterprint', uklid);
  };
  window.addEventListener('afterprint', uklid);
  // krátká prodleva, aby prohlížeč stihl vykreslit SVG
  setTimeout(() => window.print(), 50);
}
