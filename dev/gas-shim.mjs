// Napodobenina služeb Google Apps Scriptu pro lokální vývoj a testy.
// Spustí skutečný soubor apps-script/Code.gs v Node.js nad tabulkou v paměti
// (volitelně ukládanou do JSON souboru). Pokrývá jen to, co Code.gs používá.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jePrazdna(v) {
  return v === '' || v === null || v === undefined;
}

class Range {
  constructor(sheet, r, c, nr = 1, nc = 1) {
    Object.assign(this, { sheet, r, c, nr, nc });
    if (r < 1 || c < 1 || r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error(`Rozsah mimo list ${sheet.name}: ${r},${c} ${nr}x${nc} (max ${sheet.maxRows}x${sheet.maxCols})`);
    }
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = this.sheet.cells[this.r - 1 + i]?.[this.c - 1 + j];
        row.push(v instanceof Date ? new Date(v) : jePrazdna(v) ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((r) => r.length !== this.nc)) {
      throw new Error('Rozměry dat neodpovídají rozsahu');
    }
    values.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) {
    this.sheet.set(this.r, this.c, v);
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(name, cells = [], maxRows = 1000, maxCols = 26) {
    Object.assign(this, { name, cells, maxRows, maxCols });
  }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // jako Google Sheets
    if (v && typeof v === 'object' && !(v instanceof Date) && Object.prototype.toString.call(v) === '[object Date]') {
      v = new Date(v.getTime()); // Date z jiného kontextu (vm)
    }
    while (this.cells.length < r) this.cells.push([]);
    this.cells[r - 1][c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.cells.length - 1; i >= 0; i--) if ((this.cells[i] || []).some((v) => !jePrazdna(v))) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) => (row || []).forEach((v, j) => { if (!jePrazdna(v)) max = Math.max(max, j + 1); }));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; return this; }
  insertColumnsAfter(_, n) { this.maxCols += n; return this; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() { return this; }
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getId() { return 'lokalni-tabulka'; }
  getName() { return 'Evidence výpůjček (lokální)'; }
}

function serializuj(ss) {
  return JSON.stringify({
    sheets: ss.sheets.map((s) => ({
      name: s.name, maxRows: s.maxRows, maxCols: s.maxCols,
      cells: s.cells.map((row) => (row || []).map((v) => (v instanceof Date ? { $d: v.toISOString() } : v ?? ''))),
    })),
  }, null, 1);
}

function deserializuj(text) {
  const ss = new Spreadsheet();
  for (const s of JSON.parse(text).sheets) {
    const cells = s.cells.map((row) => row.map((v) => (v && typeof v === 'object' && v.$d ? new Date(v.$d) : v)));
    ss.sheets.push(new Sheet(s.name, cells, s.maxRows, s.maxCols));
  }
  return ss;
}

/**
 * Vytvoří běhové prostředí s načteným Code.gs.
 * @param {{soubor?: string, props?: Record<string,string>, ted?: () => Date}} moznosti
 */
export function vytvorProstredi(moznosti = {}) {
  const soubor = moznosti.soubor;
  let ss = soubor && fs.existsSync(soubor) ? deserializuj(fs.readFileSync(soubor, 'utf8')) : new Spreadsheet();
  const props = new Map(Object.entries(moznosti.props || {}));
  const cache = new Map();
  const uloz = () => { if (soubor) fs.writeFileSync(soubor, serializuj(ss)); };

  const kontext = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: () => {},
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const z = cache.get(k); return z && z.do > Date.now() ? z.v : null; },
        put: (k, v, s = 600) => { cache.set(k, { v: String(v), do: Date.now() + s * 1000 }); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
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
