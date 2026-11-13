// Vygeneruje ikony aplikace (PNG + SVG) bez externích knihoven.
// Spuštění: node dev/ikony.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/icons');
const POZADI = [0, 50, 103]; // FNO tmavě modrá #003267
const BILA = [255, 255, 255];
const LINKY = [148, 184, 222]; // FNO světle modrá #94B8DE

// Návrh v souřadnicích 0–100: otevřená kniha se dvěma stránkami a řádky textu.
function barva(x, y) {
  const strany = [
    { x0: 16, x1: 48, y0: 26, y1: 74 },
    { x0: 52, x1: 84, y0: 26, y1: 74 },
  ];
  for (const s of strany) {
    if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) {
      for (const ly of [36, 45, 54, 63]) {
        if (y >= ly && y <= ly + 3 && x >= s.x0 + 5 && x <= s.x1 - 5) return LINKY;
      }
      return BILA;
    }
  }
  return POZADI;
}

function png(velikost) {
  const ss = 4; // vyhlazování
  const radky = [];
  for (let y = 0; y < velikost; y++) {
    const radek = Buffer.alloc(1 + velikost * 3);
    for (let x = 0; x < velikost; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = barva(((x + (sx + 0.5) / ss) / velikost) * 100, ((y + (sy + 0.5) / ss) / velikost) * 100);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      radek[1 + x * 3] = Math.round(r / n);
      radek[2 + x * 3] = Math.round(g / n);
      radek[3 + x * 3] = Math.round(b / n);
    }
    radky.push(radek);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(velikost, 0);
  ihdr.writeUInt32BE(velikost, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bitů, RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    blok('IHDR', ihdr),
    blok('IDAT', zlib.deflateSync(Buffer.concat(radky), { level: 9 })),
    blok('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function blok(typ, data) {
  const delka = Buffer.alloc(4);
  delka.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([delka, td, crc]);
}

fs.mkdirSync(CIL, { recursive: true });
for (const v of [180, 192, 512]) fs.writeFileSync(path.join(CIL, `icon-${v}.png`), png(v));
fs.writeFileSync(path.join(CIL, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="rgb(${POZADI})"/>
<rect x="16" y="26" width="32" height="48" fill="#fff"/><rect x="52" y="26" width="32" height="48" fill="#fff"/>
<g fill="rgb(${LINKY})">${[36, 45, 54, 63].map((y) => `<rect x="21" y="${y}" width="22" height="3"/><rect x="57" y="${y}" width="22" height="3"/>`).join('')}</g>
</svg>
`);
console.log('Ikony vytvořeny v', CIL);
