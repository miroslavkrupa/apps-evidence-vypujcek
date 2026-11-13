// Spustí skutečný soubor apps-script/Code.gs v Node.js nad tabulkou v paměti
// (volitelně ukládanou do JSON souboru). Samotná napodobenina služeb Google je
// ve web/demo/gas.js – stejnou používá ukázkový režim v prohlížeči.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Spreadsheet, serializuj, deserializuj, sluzbyGas } from '../web/demo/gas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Vytvoří běhové prostředí s načteným Code.gs.
 * @param {{soubor?: string, props?: Record<string,string>}} moznosti
 */
export function vytvorProstredi(moznosti = {}) {
  const soubor = moznosti.soubor;
  const ss = soubor && fs.existsSync(soubor) ? deserializuj(JSON.parse(fs.readFileSync(soubor, 'utf8'))) : new Spreadsheet();
  const props = new Map(Object.entries(moznosti.props || {}));
  const cache = new Map();
  const uloz = () => { if (soubor) fs.writeFileSync(soubor, JSON.stringify(serializuj(ss), null, 1)); };

  const kontext = {
    console,
    ...sluzbyGas({
      ss, props, cache,
      sha256: (s) => crypto.createHash('sha256').update(s, 'utf8').digest(),
      uuid: () => crypto.randomUUID(),
    }),
  };
  vm.createContext(kontext);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), kontext, { filename: 'Code.gs' });

  return {
    kontext,
    /** Zavolá doPost stejně jako webová aplikace a vrátí rozparsovanou odpověď. */
    api(pozadavek) {
      const vysledek = JSON.parse(kontext.doPost({ postData: { contents: JSON.stringify(pozadavek) } }).getContent());
      uloz();
      return vysledek;
    },
    get() { return JSON.parse(kontext.doGet().getContent()); },
    nastavPin(klic, pin) { kontext.nastavPin_(klic, pin); },
    vymazCache() { cache.clear(); },
    tabulka: () => ss,
    uloz,
  };
}
