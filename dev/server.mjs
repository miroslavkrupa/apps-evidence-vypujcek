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
import { naplnUkazkovaData, PINY_UKAZKY } from '../web/demo/gas.js';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(DEV, '../web');
const DATA = path.join(DEV, 'data.json');
const PROPS = path.join(DEV, 'props.json');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const novaData = !fs.existsSync(DATA);
const props = fs.existsSync(PROPS) ? JSON.parse(fs.readFileSync(PROPS, 'utf8')) : {};
const gas = vytvorProstredi({ soubor: DATA, props });

if (novaData || !props.PIN_UZIVATEL) {
  gas.nastavPin('PIN_UZIVATEL', PINY_UKAZKY.uzivatel);
  gas.nastavPin('PIN_SPRAVCE', PINY_UKAZKY.spravce);
  const p = gas.kontext.PropertiesService.getScriptProperties();
  fs.writeFileSync(PROPS, JSON.stringify({
    PIN_SUL: p.getProperty('PIN_SUL'), PIN_UZIVATEL: p.getProperty('PIN_UZIVATEL'), PIN_SPRAVCE: p.getProperty('PIN_SPRAVCE'),
  }));
}

if (novaData) {
  naplnUkazkovaData((pozadavek) => gas.api(pozadavek), gas.tabulka());
  gas.uloz();
}

const TYPY = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.gs': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8',
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
