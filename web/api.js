// Komunikace s API v Google Apps Scriptu.

import { uloziste } from './util.js';

const VYCHOZI = {
  API_URL: '',
  NAZEV: 'Knihovna – Kožní oddělení',
  ODDELENI: 'Kožní oddělení FN Ostrava',
  LIMIT_DNI: 90,
  APP_URL: '',
};

export const nastaveni = { ...VYCHOZI, ...(window.APP_CONFIG || {}) };

export class ChybaApi extends Error {
  constructor(kod, zprava) {
    super(zprava);
    this.kod = kod;
  }
}

const KLIC_PIN = 'vypujcky.pin';
const KLIC_ROLE = 'vypujcky.role';

export const relace = {
  get pin() { return uloziste.get(KLIC_PIN); },
  get role() { return uloziste.get(KLIC_ROLE); },
  uloz(pin, role) { uloziste.set(KLIC_PIN, pin); uloziste.set(KLIC_ROLE, role); },
  odhlas() { uloziste.del(KLIC_PIN); uloziste.del(KLIC_ROLE); },
};

let bezicich = 0;
function prubeh(zmena) {
  bezicich += zmena;
  document.body.classList.toggle('pracuje', bezicich > 0);
}

/**
 * Zavolá akci API. Při chybě vyhodí ChybaApi s textem pro uživatele.
 * Apps Script nepodporuje CORS preflight, proto se posílá text/plain.
 */
export async function zavolej(akce, data = {}, pin = relace.pin) {
  if (!nastaveni.API_URL) throw new ChybaApi('nenastaveno', 'V souboru config.js chybí adresa API (API_URL).');
  const ovladac = new AbortController();
  const casovac = setTimeout(() => ovladac.abort(), 45000);
  prubeh(+1);
  try {
    let odpoved;
    try {
      odpoved = await fetch(nastaveni.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ akce, pin, data }),
        redirect: 'follow',
        signal: ovladac.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new ChybaApi('sit', 'Server neodpověděl včas. Zkuste to prosím znovu.');
      throw new ChybaApi('sit', 'Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.');
    }
    if (!odpoved.ok) throw new ChybaApi('sit', `Server odpověděl chybou ${odpoved.status}.`);
    let json;
    try {
      json = await odpoved.json();
    } catch {
      throw new ChybaApi('sit', 'Server nevrátil platnou odpověď. Zkontrolujte adresu API v config.js a nasazení Apps Scriptu.');
    }
    if (!json.ok) throw new ChybaApi(json.kod || 'chyba', json.chyba || 'Neznámá chyba serveru.');
    return json;
  } finally {
    clearTimeout(casovac);
    prubeh(-1);
  }
}
