// Lokální vývojový server: obslouží složku web/ a na /api spouští skutečný
// apps-script/Code.gs nad tabulkou uloženou v dev/data.json.
//
// Spuštění:  node dev/server.mjs  [port]      → http://localhost:8080/
// Ukázkové PINy: pracovníci 111111, správce 999999
// Data smažete odstraněním souboru dev/data.json.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vytvorProstredi } from './gas-shim.mjs';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(DEV, '../web');
const DATA = path.join(DEV, 'data.json');
const PROPS = path.join(DEV, 'props.json');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const novaData = !fs.existsSync(DATA);
const props = fs.existsSync(PROPS) ? JSON.parse(fs.readFileSync(PROPS, 'utf8')) : {};
const gas = vytvorProstredi({ soubor: DATA, props });

if (novaData || !props.PIN_UZIVATEL) {
  gas.nastavPin('PIN_UZIVATEL', '111111');
  gas.nastavPin('PIN_SPRAVCE', '999999');
  const p = gas.kontext.PropertiesService.getScriptProperties();
  fs.writeFileSync(PROPS, JSON.stringify({
    PIN_SUL: p.getProperty('PIN_SUL'), PIN_UZIVATEL: p.getProperty('PIN_UZIVATEL'), PIN_SPRAVCE: p.getProperty('PIN_SPRAVCE'),
  }));
}

if (novaData) {
  const s = (akce, data) => gas.api({ akce, pin: '999999', data });
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
  const u = (akce, data) => gas.api({ akce, pin: '111111', data });
  u('vypujcit', { kniha: 'K0002', pracovnik: 'P001' });
  u('vypujcit', { kniha: 'K0004', pracovnik: 'P003' });
  // jedna stará výpůjčka (pro zvýraznění dlouhých výpůjček)
  u('vypujcit', { kniha: 'K0007', pracovnik: 'P002' });
  const list = gas.tabulka().getSheetByName('Vypujcky');
  list.getRange(list.getLastRow(), 4).setValue(new Date(Date.now() - 140 * 864e5));
  gas.uloz();
}

const TYPY = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api') {
    if (req.method === 'GET') return poslat(res, 200, TYPY['.json'], JSON.stringify(gas.get()));
    let telo = '';
    req.on('data', (c) => { telo += c; });
    req.on('end', () => {
      // umělé zpoždění podobné Apps Scriptu
      setTimeout(() => {
        const odpoved = gas.kontext.doPost({ postData: { contents: telo } }).getContent();
        gas.uloz();
        poslat(res, 200, TYPY['.json'], odpoved);
      }, 400);
    });
    return;
  }
  if (url.pathname === '/config.js') {
    return poslat(res, 200, TYPY['.js'], "window.APP_CONFIG = { API_URL: '/api', LIMIT_DNI: 90, NAZEV: 'Knihovna – Kožní oddělení (vývoj)' };\n");
  }
  let soubor = path.join(WEB, decodeURIComponent(url.pathname));
  if (!soubor.startsWith(WEB)) return poslat(res, 403, TYPY['.txt'], 'Zakázáno');
  if (fs.existsSync(soubor) && fs.statSync(soubor).isDirectory()) soubor = path.join(soubor, 'index.html');
  if (!fs.existsSync(soubor)) return poslat(res, 404, TYPY['.txt'], 'Nenalezeno');
  poslat(res, 200, TYPY[path.extname(soubor)] || 'application/octet-stream', fs.readFileSync(soubor));
}).listen(PORT, () => {
  console.log(`Evidence výpůjček běží na http://localhost:${PORT}/  (PIN pracovníci 111111, správce 999999)`);
});

function poslat(res, kod, typ, telo) {
  res.writeHead(kod, { 'Content-Type': typ, 'Cache-Control': 'no-store' });
  res.end(telo);
}
