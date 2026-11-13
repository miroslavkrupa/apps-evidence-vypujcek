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

// Ukázkový režim (testovací data jen v tomto prohlížeči) – jen dokud config.js nemá adresu API,
// aby se ostrý provoz nikdy nepomíchal s ukázkou.
const KLIC_UKAZKA = 'vypujcky.ukazka';

export const ukazka = {
  get mozna() { return !nastaveni.API_URL; },
  get aktivni() { return !nastaveni.API_URL && uloziste.get(KLIC_UKAZKA) === '1'; },
  zapnout() { uloziste.set(KLIC_UKAZKA, '1'); },
  async smazData() { (await import('./demo/ukazka.js')).smazUkazkovaData(); },
  async vypnout() { uloziste.del(KLIC_UKAZKA); await this.smazData(); },
};

/**
 * Zavolá akci API. Při chybě vyhodí ChybaApi s textem pro uživatele.
 * Apps Script nepodporuje CORS preflight, proto se posílá text/plain.
 */
export async function zavolej(akce, data = {}, pin = relace.pin) {
  if (!nastaveni.API_URL && !ukazka.aktivni) {
    throw new ChybaApi('nenastaveno', 'V souboru config.js chybí adresa API (API_URL).');
  }
  prubeh(+1);
  try {
    const json = ukazka.aktivni ? await zavolejUkazku(akce, data, pin) : await zavolejServer(akce, data, pin);
    if (!json.ok) throw new ChybaApi(json.kod || 'chyba', json.chyba || 'Neznámá chyba serveru.');
    return json;
  } finally {
    prubeh(-1);
  }
}

async function zavolejUkazku(akce, data, pin) {
  try {
    const { zavolejUkazku } = await import('./demo/ukazka.js');
    return await zavolejUkazku({ akce, pin, data });
  } catch (err) {
    throw new ChybaApi('sit', err.message || 'Ukázku se nepodařilo spustit.');
  }
}

async function zavolejServer(akce, data, pin) {
  const ovladac = new AbortController();
  const casovac = setTimeout(() => ovladac.abort(), 45000);
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
    try {
      return await odpoved.json();
    } catch {
      throw new ChybaApi('sit', 'Server nevrátil platnou odpověď. Zkontrolujte adresu API v config.js a nasazení Apps Scriptu.');
    }
  } finally {
    clearTimeout(casovac);
  }
}
