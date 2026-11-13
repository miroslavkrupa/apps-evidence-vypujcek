// Ukázkový režim: skutečný apps-script/Code.gs běží přímo v prohlížeči nad testovacími daty
// uloženými v localStorage. Nic se neposílá na server. Zapíná se jen tehdy, když config.js
// nemá adresu API (viz api.js), takže ostrý provoz nikdy neovlivní.

import { Spreadsheet, serializuj, deserializuj, sluzbyGas, naplnUkazkovaData, PINY_UKAZKY } from './gas.js';

export { PINY_UKAZKY };

const KLIC_DATA = 'vypujcky.ukazka.data';

// Code.gs leží mimo složku web/; na GitHub Pages se publikuje celý repozitář.
const ADRESA_KODU = new URL('../../apps-script/Code.gs', import.meta.url);

let prostredi = null;

async function priprav() {
  if (prostredi) return prostredi;
  const odpoved = await fetch(ADRESA_KODU, { cache: 'no-cache' });
  if (!odpoved.ok) throw new Error('Ukázka není v tomto nasazení k dispozici (chybí apps-script/Code.gs).');
  const kod = await odpoved.text();

  let ulozeno = null;
  try { ulozeno = JSON.parse(localStorage.getItem(KLIC_DATA) || 'null'); } catch { /* poškozená data */ }
  const ss = ulozeno ? deserializuj(ulozeno.tabulka) : new Spreadsheet();
  const props = new Map(Object.entries(ulozeno?.props || {}));
  const cache = new Map();
  const sluzby = sluzbyGas({ ss, props, cache, sha256: (s) => sha256(new TextEncoder().encode(s)), uuid });

  const jmena = Object.keys(sluzby);
  // eslint-disable-next-line no-new-func
  const gs = new Function(...jmena, `${kod}\n;return { doPost, nastavPin_ };`)(...jmena.map((j) => sluzby[j]));

  const uloz = () => {
    try {
      localStorage.setItem(KLIC_DATA, JSON.stringify({ tabulka: serializuj(ss), props: Object.fromEntries(props) }));
    } catch { /* soukromý režim – data vydrží jen do zavření stránky */ }
  };
  const volej = (pozadavek) => JSON.parse(gs.doPost({ postData: { contents: JSON.stringify(pozadavek) } }).getContent());

  if (!ulozeno) {
    gs.nastavPin_('PIN_UZIVATEL', PINY_UKAZKY.uzivatel);
    gs.nastavPin_('PIN_SPRAVCE', PINY_UKAZKY.spravce);
    naplnUkazkovaData(volej, ss);
    uloz();
  }
  prostredi = { volej, uloz };
  return prostredi;
}

/** Stejné rozhraní jako POST na Apps Script: vrací {ok, …} nebo {ok:false, kod, chyba}. */
export async function zavolejUkazku(pozadavek) {
  const p = await priprav();
  await new Promise((r) => setTimeout(r, 250)); // ať je vidět průběh jako u skutečného serveru
  const vysledek = p.volej(pozadavek);
  p.uloz();
  return vysledek;
}

export function smazUkazkovaData() {
  try { localStorage.removeItem(KLIC_DATA); } catch { /* nic */ }
  prostredi = null;
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Synchronní SHA-256 (Apps Script počítá hash synchronně, crypto.subtle je jen asynchronní).
const K = [];
const H0 = [];
(() => {
  const zlomek = (x) => ((x - Math.floor(x)) * 0x100000000) >>> 0;
  for (let n = 2, i = 0; i < 64; n++) {
    let prvocislo = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prvocislo = false; break; }
    if (!prvocislo) continue;
    if (i < 8) H0[i] = zlomek(Math.sqrt(n));
    K[i++] = zlomek(Math.cbrt(n));
  }
})();

export function sha256(bajty) {
  const delka = bajty.length;
  const bloky = Math.ceil((delka + 9) / 64);
  const zprava = new Uint8Array(bloky * 64);
  zprava.set(bajty);
  zprava[delka] = 0x80;
  const dv = new DataView(zprava.buffer);
  dv.setUint32(zprava.length - 8, Math.floor(delka / 0x20000000));
  dv.setUint32(zprava.length - 4, (delka * 8) >>> 0);

  const h = H0.slice();
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < bloky; b++) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(b * 64 + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    [a, bb, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
  }
  const vysledek = new Uint8Array(32);
  const out = new DataView(vysledek.buffer);
  h.forEach((x, i) => out.setUint32(i * 4, x));
  return vysledek;
}
