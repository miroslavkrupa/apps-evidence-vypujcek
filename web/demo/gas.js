// Napodobenina služeb Google Apps Scriptu nad tabulkou v paměti.
// Sdílí ji lokální vývojový server a testy (dev/) i ukázkový režim v prohlížeči (web/demo/).
// Pokrývá jen to, co apps-script/Code.gs používá při volání API. Nic z Node.js ani z prohlížeče
// nepotřebuje – hash a UUID dodá volající.

function jePrazdna(v) {
  return v === '' || v === null || v === undefined;
}

function jeDatum(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

export class Range {
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
        row.push(jeDatum(v) ? new Date(v.getTime()) : jePrazdna(v) ? '' : v);
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

export class Sheet {
  constructor(name, cells = [], maxRows = 1000, maxCols = 26) {
    Object.assign(this, { name, cells, maxRows, maxCols });
  }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // jako Google Sheets
    if (jeDatum(v)) v = new Date(v.getTime()); // i Date z jiného kontextu (vm)
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

export class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getId() { return 'lokalni-tabulka'; }
  getName() { return 'Evidence výpůjček (lokální)'; }
}

/** Tabulka → prostý objekt pro JSON (data jako {$d: ISO}). */
export function serializuj(ss) {
  return {
    sheets: ss.sheets.map((s) => ({
      name: s.name, maxRows: s.maxRows, maxCols: s.maxCols,
      cells: s.cells.map((row) => (row || []).map((v) => (jeDatum(v) ? { $d: v.toISOString() } : v ?? ''))),
    })),
  };
}

export function deserializuj(obj) {
  const ss = new Spreadsheet();
  for (const s of obj.sheets) {
    const cells = s.cells.map((row) => row.map((v) => (v && typeof v === 'object' && v.$d ? new Date(v.$d) : v)));
    ss.sheets.push(new Sheet(s.name, cells, s.maxRows, s.maxCols));
  }
  return ss;
}

/**
 * Globální objekty, které Code.gs očekává (SpreadsheetApp, PropertiesService, …).
 * @param {{ss: Spreadsheet, props: Map<string,string>, cache: Map, sha256: (text: string) => Uint8Array|number[], uuid: () => string}} o
 */
export function sluzbyGas({ ss, props, cache, sha256, uuid }) {
  return {
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
      // Apps Script vrací bajty se znaménkem (-128…127).
      computeDigest: (_, s) => Array.from(sha256(String(s))).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: uuid,
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
  };
}

export const PINY_UKAZKY = { uzivatel: '111111', spravce: '999999' };

/**
 * Naplní prázdnou tabulku ukázkovými knihami, pracovníky a výpůjčkami.
 * @param {(pozadavek: {akce: string, pin: string, data: object}) => object} volej  volání doPost
 * @param {Spreadsheet} ss
 */
export function naplnUkazkovaData(volej, ss) {
  const s = (akce, data) => volej({ akce, pin: PINY_UKAZKY.spravce, data });
  const u = (akce, data) => volej({ akce, pin: PINY_UKAZKY.uzivatel, data });
  s('importKnih', {
    knihy: [
      { nazev: 'Dermatologie a venerologie', autor: 'Štork J. a kol.', vydani: '3. vyd., 2019', umisteni: 'Police 1' },
      { nazev: 'Fitzpatrick\'s Dermatology', autor: 'Kang S. et al.', vydani: '9th ed., 2019', umisteni: 'Police 1' },
      { nazev: 'Rook\'s Textbook of Dermatology', autor: 'Griffiths C. et al.', vydani: '10th ed., 2024', umisteni: 'Police 1' },
      { nazev: 'Dermatoskopie v praxi', autor: 'Lettlová H.', vydani: '2. vyd., 2020', umisteni: 'Police 2' },
      { nazev: 'Atlas dermatologických diagnóz', autor: 'Arenberger P.', vydani: '2015', umisteni: 'Police 2' },
      { nazev: 'Andrews\' Diseases of the Skin', autor: 'James W. D. et al.', vydani: '13th ed., 2019', umisteni: 'Police 2' },
      { nazev: 'Dětská dermatologie', autor: 'Bučková H.', vydani: '2. vyd., 2016', umisteni: 'Police 3' },
      { nazev: 'Pediatric Dermatology', autor: 'Schachner L.', vydani: '5th ed., 2021', umisteni: 'Police 3' },
    ],
  });
  ['MUDr. Jana Nováková', 'MUDr. Petr Svoboda', 'Bc. Lucie Dvořáková', 'Martina Černá'].forEach((jmeno, i) =>
    s('ulozitPracovnika', { jmeno, funkce: ['lékařka', 'lékař', 'sestra', 'sestra'][i] }));
  u('vypujcit', { kniha: 'K0002', pracovnik: 'P001' });
  u('vypujcit', { kniha: 'K0004', pracovnik: 'P003' });
  // jedna stará výpůjčka (pro zvýraznění dlouhých výpůjček)
  u('vypujcit', { kniha: 'K0007', pracovnik: 'P002' });
  const list = ss.getSheetByName('Vypujcky');
  list.getRange(list.getLastRow(), 4).setValue(new Date(Date.now() - 140 * 864e5));
}
