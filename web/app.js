// Evidence výpůjček – hlavní logika aplikace.

import { el, $, datum, datumCas, dniOd, dnyText, knihText, proHledani, odpovida, toast, pipnout, odemkniZvuk, uloziste } from './util.js';
import { zavolej, relace, nastaveni } from './api.js';
import { Kamera, rozpoznejKod, poslouchejCtecku } from './skener.js';
import { FORMATY_STITKU, stranyStitku, stranyKarticek, vytiskni, adresaAplikace } from './tisk.js';

const VERZE = '1.0';
const NECINNOST_MS = 90 * 1000;
const MAX_RADKU = 200;

const stav = {
  role: null,
  knihy: [],
  pracovnici: [],
  otevrene: [],
  mapaKnih: new Map(),
  mapaPrac: new Map(),
  venku: new Map(), // id knihy → otevřená výpůjčka
  nacteno: 0,
  pohled: 'skenovat',
  tok: novyTok(),
  odlozenyKod: null,
};

function novyTok(zmeny = {}) {
  return { krok: 'start', kniha: null, pracovnik: null, rucne: false, zprava: null, posledni: null, ...zmeny };
}

const jeSpravce = () => stav.role === 'spravce';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function preindexuj() {
  stav.mapaKnih = new Map(stav.knihy.map((k) => [k.id, k]));
  stav.mapaPrac = new Map(stav.pracovnici.map((p) => [p.id, p]));
  stav.venku = new Map(stav.otevrene.map((v) => [v.kniha, v]));
  for (const k of stav.knihy) k._h = proHledani(k.id, k.nazev, k.autor, k.vydani, k.isbn, k.umisteni);
  for (const p of stav.pracovnici) p._h = proHledani(p.id, p.jmeno, p.funkce);
}

async function nacist(tise = false) {
  try {
    const d = await zavolej('nacist');
    stav.knihy = d.knihy;
    stav.pracovnici = d.pracovnici;
    stav.otevrene = d.otevrene;
    stav.nacteno = Date.now();
    preindexuj();
    prekresli();
    if (!tise) toast('Data jsou aktuální.', 'ok', 1800);
    return true;
  } catch (e) {
    obsluzChybu(e);
    return false;
  }
}

function obsluzChybu(e) {
  if (e.kod === 'neplatny_pin') {
    odhlasit('PIN byl změněn. Přihlaste se prosím znovu.');
    return;
  }
  toast(e.message, 'chyba', 6000);
}

function knihaVypujcena(v) {
  stav.otevrene.push(v);
  preindexuj();
  prekresliOdznak();
}

function knihaVracena(id) {
  stav.otevrene = stav.otevrene.filter((v) => v.kniha !== id);
  preindexuj();
  prekresliOdznak();
}

async function apiVypujcit(k, p, zpusob) {
  const r = await zavolej('vypujcit', { kniha: k.id, pracovnik: p.id, zpusob });
  knihaVypujcena(r.vypujcka);
  return r.vypujcka;
}

async function apiVratit(k) {
  const r = await zavolej('vratit', { kniha: k.id });
  knihaVracena(k.id);
  return r.vypujcka;
}

function pocetKnih(pracId) {
  return stav.otevrene.filter((v) => v.pracovnik === pracId).length;
}

function jmenoPracovnika(v) {
  return stav.mapaPrac.get(v.pracovnik)?.jmeno || v.jmenoPracovnika || v.pracovnik;
}

function nazevKnihy(v) {
  return stav.mapaKnih.get(v.kniha)?.nazev || v.nazevKnihy || v.kniha;
}

// ---------------------------------------------------------------------------
// Přihlášení
// ---------------------------------------------------------------------------

function zobrazPrihlaseni(zprava = '') {
  kamera.zastav();
  $('#aplikace').hidden = true;
  $('#prihlaseni').hidden = false;
  $('#prihlaseni-podnadpis').textContent = nastaveni.NAZEV;
  $('#prihlaseni-chyba').textContent = !nastaveni.API_URL
    ? 'Aplikace není nastavená: v souboru config.js chybí adresa API.'
    : zprava;
  $('#pin').value = '';
  setTimeout(() => $('#pin').focus(), 50);
}

async function prihlasit(e) {
  e.preventDefault();
  const pin = $('#pin').value.trim();
  const tlacitko = e.submitter || $('#form-prihlaseni button');
  tlacitko.disabled = true;
  $('#prihlaseni-chyba').textContent = '';
  try {
    const r = await zavolej('prihlasit', {}, pin);
    relace.uloz(pin, r.role);
    stav.role = r.role;
    zobrazAplikaci();
    await nacist(true);
    zpracujOdlozeny();
  } catch (err) {
    $('#prihlaseni-chyba').textContent = err.message;
    $('#pin').select();
  } finally {
    tlacitko.disabled = false;
  }
}

function odhlasit(zprava = '') {
  relace.odhlas();
  stav.role = null;
  stav.tok = novyTok();
  zavriDialog();
  zobrazPrihlaseni(zprava);
}

function zobrazAplikaci() {
  $('#prihlaseni').hidden = true;
  $('#aplikace').hidden = false;
  $('#nav-sprava').hidden = !jeSpravce();
  if (stav.pohled === 'sprava' && !jeSpravce()) stav.pohled = 'skenovat';
  prepniPohled(stav.pohled);
}

// ---------------------------------------------------------------------------
// Navigace
// ---------------------------------------------------------------------------

function prepniPohled(nazev) {
  stav.pohled = nazev;
  document.querySelectorAll('.navigace button').forEach((b) => {
    const aktivni = b.dataset.pohled === nazev;
    b.classList.toggle('aktivni', aktivni);
    if (aktivni) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.pohled').forEach((s) => { s.hidden = s.id !== `pohled-${nazev}`; });
  if (nazev === 'skenovat') spustKameru();
  else kamera.zastav();
  prekresli();
}

function prekresli() {
  prekresliOdznak();
  switch (stav.pohled) {
    case 'skenovat': vykresliTok(); break;
    case 'vypujcene': vykresliVypujcene(); break;
    case 'knihy': vykresliKnihy(); break;
    case 'lide': vykresliLide(); break;
    case 'sprava': vykresliSpravu(); break;
  }
}

function prekresliOdznak() {
  $('#pocet-vypujcenych').textContent = stav.otevrene.length || '';
}

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------

const kamera = new Kamera($('#video'), (text) => {
  const ramec = $('#kamera-ramec');
  ramec.classList.add('zachyceno');
  setTimeout(() => ramec.classList.remove('zachyceno'), 400);
  zpracujKod(text, 'sken');
});
let kameraZapnuta = uloziste.get('vypujcky.kamera') !== 'vypnuta';
let spoustimKameru = false;

async function spustKameru() {
  const ramec = $('#kamera-ramec');
  const zprava = $('#kamera-zprava');
  $('#kamera-prepnout').textContent = kameraZapnuta ? 'Vypnout kameru' : 'Zapnout kameru';
  if (!kameraZapnuta) {
    kamera.zastav();
    ramec.classList.add('vypnuta');
    zprava.hidden = false;
    zprava.replaceChildren(el('div', {},
      el('p', {}, 'Kamera je vypnutá. Můžete použít USB čtečku nebo zadat ručně.'),
      el('button', { type: 'button', class: 'tlacitko', onclick: () => prepniKameru(true) }, 'Zapnout kameru')));
    return;
  }
  if (kamera.bezi || spoustimKameru || document.hidden) return;
  spoustimKameru = true;
  ramec.classList.remove('vypnuta');
  zprava.hidden = true;
  try {
    await kamera.spust();
    if (stav.pohled !== 'skenovat' || !kameraZapnuta) kamera.zastav();
  } catch (e) {
    ramec.classList.add('vypnuta');
    zprava.hidden = false;
    zprava.replaceChildren(el('div', {},
      el('p', {}, popisChybyKamery(e)),
      el('button', { type: 'button', class: 'tlacitko', onclick: spustKameru }, 'Zkusit znovu')));
  } finally {
    spoustimKameru = false;
  }
}

function prepniKameru(zapnout = !kameraZapnuta) {
  kameraZapnuta = zapnout;
  uloziste.set('vypujcky.kamera', zapnout ? 'zapnuta' : 'vypnuta');
  if (!zapnout) kamera.zastav();
  spustKameru();
}

function popisChybyKamery(e) {
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
    return 'Přístup ke kameře není povolený. Povolte kameru pro tuto stránku v nastavení prohlížeče, nebo použijte „Zadat ručně“.';
  }
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) {
    return 'Kamera nebyla nalezena. Použijte USB čtečku nebo „Zadat ručně“.';
  }
  if (e && e.name === 'NotReadableError') return 'Kameru právě používá jiná aplikace.';
  return `Kameru se nepodařilo spustit${e && e.message ? `: ${e.message}` : '.'}`;
}

// ---------------------------------------------------------------------------
// Výpůjčka / vrácení – průběh skenování
// ---------------------------------------------------------------------------

let casovacNecinnosti;
function aktivita() {
  clearTimeout(casovacNecinnosti);
  casovacNecinnosti = setTimeout(() => {
    const krok = stav.tok.krok;
    if (krok === 'start' || krok === 'uklada') return;
    const rozpracovano = krok === 'cekam_pracovnika' || krok === 'cekam_knihu';
    stav.tok = novyTok(rozpracovano ? { zprava: { typ: 'varovani', text: 'Rozpracovaná výpůjčka byla kvůli nečinnosti zrušena.' } } : {});
    if (stav.pohled === 'skenovat') vykresliTok();
  }, NECINNOST_MS);
}

function zrusTok() {
  stav.tok = novyTok();
  kamera.zapomen();
  vykresliTok();
}

async function zpracujKod(text, zpusob) {
  if ($('#aplikace').hidden) return;
  if (stav.tok.krok === 'uklada') return;
  zavriDialog();
  if (stav.pohled !== 'skenovat') prepniPohled('skenovat');
  aktivita();
  const kod = rozpoznejKod(text);
  if (!kod) {
    chybaToku(`Tento kód aplikace nezná: „${String(text).slice(0, 60)}“`);
    return;
  }
  if (kod.typ === 'kniha') await vybranaKniha(kod.id, zpusob);
  else await vybranyPracovnik(kod.id, zpusob);
}

function chybaToku(text) {
  pipnout(false);
  stav.tok = { ...stav.tok, zprava: { typ: 'chyba', text } };
  if (stav.tok.krok === 'hotovo') stav.tok = novyTok({ zprava: { typ: 'chyba', text } });
  vykresliTok();
}

async function najdiSObnovenim(mapa, id) {
  if (!mapa().has(id)) await nacist(true); // mohla přibýt na jiném zařízení
  return mapa().get(id);
}

async function vybranaKniha(id, zpusob) {
  const k = await najdiSObnovenim(() => stav.mapaKnih, id);
  if (!k) return chybaToku(`Kniha ${id} není v evidenci.`);
  if (!k.aktivni) return chybaToku(`Kniha ${id} (${k.nazev}) je vyřazená z evidence.`);
  const t = stav.tok;
  const rucne = zpusob === 'rucne';
  if (stav.venku.has(id)) {
    const cekajici = t.krok === 'cekam_knihu' ? t.pracovnik : null;
    stav.tok = novyTok({ krok: 'vypujcena', kniha: k, pracovnik: cekajici, rucne });
    pipnout(true);
    vykresliTok();
    return;
  }
  if (t.krok === 'cekam_knihu' && t.pracovnik) {
    await vypujcitVToku(k, t.pracovnik, t.rucne || rucne);
    return;
  }
  stav.tok = novyTok({ krok: 'cekam_pracovnika', kniha: k, rucne });
  pipnout(true);
  vykresliTok();
}

async function vybranyPracovnik(id, zpusob) {
  const p = await najdiSObnovenim(() => stav.mapaPrac, id);
  if (!p) return chybaToku(`Pracovník ${id} není v evidenci.`);
  if (!p.aktivni) return chybaToku(`Pracovník ${p.jmeno} je deaktivovaný.`);
  const t = stav.tok;
  const rucne = zpusob === 'rucne';
  if (t.krok === 'cekam_pracovnika' && t.kniha) {
    await vypujcitVToku(t.kniha, p, t.rucne || rucne);
    return;
  }
  stav.tok = novyTok({ krok: 'cekam_knihu', pracovnik: p, rucne });
  pipnout(true);
  vykresliTok();
}

async function vypujcitVToku(k, p, rucne) {
  stav.tok = novyTok({ krok: 'uklada', kniha: k, pracovnik: p });
  vykresliTok();
  try {
    await apiVypujcit(k, p, rucne ? 'rucne' : 'sken');
    stav.tok = novyTok({ krok: 'hotovo', posledni: { typ: 'vypujceno', kniha: k, pracovnik: p } });
    pipnout(true);
  } catch (e) {
    stav.tok = novyTok({ zprava: { typ: 'chyba', text: e.message } });
    pipnout(false);
    if (e.kod === 'neplatny_pin') return obsluzChybu(e);
    if (['jiz_vypujceno', 'nenalezeno', 'neaktivni'].includes(e.kod)) nacist(true);
  }
  kamera.zapomen();
  vykresliTok();
}

async function vratitVToku() {
  const { kniha: k, pracovnik: cekajici } = stav.tok;
  const v = stav.venku.get(k.id);
  stav.tok = novyTok({ krok: 'uklada', kniha: k });
  vykresliTok();
  try {
    await apiVratit(k);
    stav.tok = novyTok({ krok: 'hotovo', posledni: { typ: 'vraceno', kniha: k, jmeno: v ? jmenoPracovnika(v) : '', dalsi: cekajici } });
    pipnout(true);
  } catch (e) {
    stav.tok = novyTok({ zprava: { typ: 'chyba', text: e.message } });
    pipnout(false);
    if (e.kod === 'neplatny_pin') return obsluzChybu(e);
    if (e.kod === 'nevypujceno') nacist(true);
  }
  kamera.zapomen();
  vykresliTok();
  aktivita();
}

function objektKnihy(k, doplnek) {
  return el('div', { class: 'objekt' },
    el('div', { class: 'objekt-ikona', 'aria-hidden': 'true' }, '📖'),
    el('div', {},
      el('div', { class: 'objekt-nazev' }, k.nazev),
      el('div', { class: 'objekt-popis' }, [k.autor, k.vydani, k.id].filter(Boolean).join(' · ')),
      doplnek ? el('div', { class: 'objekt-popis' }, doplnek) : null));
}

function objektPracovnika(p) {
  const n = pocetKnih(p.id);
  const inicialy = p.jmeno.replace(/^(MUDr|Bc|Mgr|Ing|PhDr|doc|prof|RNDr)\.\s*/gi, '').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return el('div', { class: 'objekt' },
    el('div', { class: 'objekt-ikona', 'aria-hidden': 'true' }, inicialy || '👤'),
    el('div', {},
      el('div', { class: 'objekt-nazev' }, p.jmeno),
      el('div', { class: 'objekt-popis' }, [p.funkce, p.id, n ? `má půjčeno: ${knihText(n)}` : 'nemá nic půjčeno'].filter(Boolean).join(' · '))));
}

function tlacitko(text, onclick, trida = '') {
  return el('button', { type: 'button', class: `tlacitko ${trida}`, onclick }, text);
}

function vykresliTok() {
  const t = stav.tok;
  const obal = $('#tok');
  const casti = [];
  const zprava = t.zprava ? el('div', { class: `stav-pruh ${t.zprava.typ}`, role: t.zprava.typ === 'chyba' ? 'alert' : null }, t.zprava.text) : null;

  switch (t.krok) {
    case 'start':
      casti.push(
        el('div', { class: 'tok-krok' }, 'Připraveno'),
        zprava,
        el('div', { class: 'tok-vyzva' }, 'Naskenujte knihu nebo kartičku pracovníka'),
        el('p', { class: 'tlumene' }, 'Výpůjčka: kniha + kartička (v libovolném pořadí). Vrácení: stačí naskenovat jen knihu.'));
      break;
    case 'cekam_pracovnika':
      casti.push(
        el('div', { class: 'tok-krok' }, 'Výpůjčka'),
        zprava,
        objektKnihy(t.kniha, el('span', { class: 'stitek volna' }, 'volná')),
        el('div', { class: 'tok-vyzva' }, 'Teď naskenujte kartičku pracovníka'),
        el('div', { class: 'radek-tlacitek' },
          tlacitko('Vybrat pracovníka ze seznamu', () => vyberDialog('pracovnik', (p) => zpracujKod(p.id, 'rucne'))),
          tlacitko('Zrušit', zrusTok)));
      break;
    case 'cekam_knihu':
      casti.push(
        el('div', { class: 'tok-krok' }, 'Výpůjčka'),
        zprava,
        objektPracovnika(t.pracovnik),
        el('div', { class: 'tok-vyzva' }, 'Teď naskenujte knihu'),
        el('div', { class: 'radek-tlacitek' },
          tlacitko('Vybrat knihu ze seznamu', () => vyberDialog('kniha', (k) => zpracujKod(k.id, 'rucne'))),
          tlacitko('Zrušit', zrusTok)));
      break;
    case 'vypujcena': {
      const v = stav.venku.get(t.kniha.id);
      const drzitel = v ? jmenoPracovnika(v) : '?';
      const dni = v ? dniOd(v.vypujceno) : 0;
      casti.push(
        el('div', { class: 'tok-krok' }, 'Vrácení'),
        zprava,
        objektKnihy(t.kniha),
        el('div', { class: `stav-pruh ${dni > nastaveni.LIMIT_DNI ? 'varovani' : 'ok'}` },
          `Vypůjčeno: ${drzitel}, od ${datum(v?.vypujceno)} (${dnyText(dni)})`),
        t.pracovnik && v && t.pracovnik.id !== v.pracovnik
          ? el('p', { class: 'tlumene' }, `Kniha je u jiného pracovníka. Po vrácení ji můžete půjčit: ${t.pracovnik.jmeno}.`)
          : null,
        tlacitko('Vrátit knihu', vratitVToku, 'hlavni velke'),
        tlacitko('Zrušit', zrusTok));
      break;
    }
    case 'uklada':
      casti.push(
        el('div', { class: 'tok-krok' }, 'Ukládám…'),
        t.kniha ? objektKnihy(t.kniha) : null,
        t.pracovnik ? objektPracovnika(t.pracovnik) : null);
      break;
    case 'hotovo': {
      const p = t.posledni;
      if (p.typ === 'vypujceno') {
        casti.push(
          el('div', { class: 'stav-pruh ok', role: 'status' }, `✓ Vypůjčeno – ${p.pracovnik.jmeno}`),
          objektKnihy(p.kniha),
          el('div', { class: 'radek-tlacitek' },
            tlacitko(`Další kniha pro ${p.pracovnik.jmeno}`, () => {
              stav.tok = novyTok({ krok: 'cekam_knihu', pracovnik: p.pracovnik });
              aktivita();
              vykresliTok();
            }, 'hlavni'),
            tlacitko('Hotovo', zrusTok)),
          el('p', { class: 'tlumene' }, 'Můžete rovnou skenovat další knihu nebo kartičku.'));
      } else {
        casti.push(
          el('div', { class: 'stav-pruh ok', role: 'status' }, `✓ Vráceno${p.jmeno ? ` (měl/a: ${p.jmeno})` : ''}`),
          objektKnihy(p.kniha),
          p.dalsi
            ? tlacitko(`Půjčit tuto knihu: ${p.dalsi.jmeno}`, () => vypujcitVToku(p.kniha, p.dalsi, false), 'hlavni velke')
            : null,
          el('p', { class: 'tlumene' }, 'Můžete rovnou skenovat další knihu.'));
      }
      break;
    }
  }
  obal.replaceChildren(...casti.filter(Boolean));
}

// ---------------------------------------------------------------------------
// Dialogy
// ---------------------------------------------------------------------------

const dialog = $('#dialog');

function otevriDialog(titulek, ...obsah) {
  $('#dialog-titulek').textContent = titulek;
  $('#dialog-obsah').replaceChildren(...obsah.filter(Boolean));
  if (!dialog.open) dialog.showModal();
  kamera.pozastaveno = true;
}

function zavriDialog() {
  if (dialog.open) dialog.close();
}

// Událost close přichází asynchronně – mezitím už může být otevřený další dialog.
dialog.addEventListener('close', () => {
  kamera.pozastaveno = dialog.open;
});
$('#dialog-zavrit').addEventListener('click', zavriDialog);
dialog.addEventListener('click', (e) => { if (e.target === dialog) zavriDialog(); });

/**
 * Výběr knihy nebo pracovníka ze seznamu s hledáním.
 * @param {'kniha'|'pracovnik'|'oboji'} typ
 */
function vyberDialog(typ, priVyberu, { jenVolne = false } = {}) {
  const hledani = el('input', { type: 'search', placeholder: typ === 'pracovnik' ? 'Hledat jméno…' : typ === 'kniha' ? 'Hledat název, autora, ID…' : 'Hledat knihu nebo pracovníka…', 'aria-label': 'Hledat' });
  const seznam = el('ul', { class: 'seznam' });
  const vyber = (fn) => () => { zavriDialog(); priVyberu(fn); };

  const vykresli = () => {
    const q = hledani.value;
    const polozky = [];
    if (typ !== 'kniha') {
      stav.pracovnici.filter((p) => p.aktivni && odpovida(p._h, q))
        .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'))
        .slice(0, 60)
        .forEach((p) => polozky.push(el('li', {}, el('button', { type: 'button', class: 'polozka', onclick: vyber(p) },
          el('div', { class: 'polozka-text' },
            el('div', { class: 'polozka-nazev' }, p.jmeno),
            el('div', { class: 'polozka-popis' }, [typ === 'oboji' ? 'Pracovník' : '', p.funkce, p.id].filter(Boolean).join(' · ')))))));
    }
    if (typ !== 'pracovnik') {
      stav.knihy.filter((k) => k.aktivni && (!jenVolne || !stav.venku.has(k.id)) && odpovida(k._h, q))
        .sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
        .slice(0, 100)
        .forEach((k) => polozky.push(el('li', {}, el('button', { type: 'button', class: 'polozka', onclick: vyber(k) },
          el('div', { class: 'polozka-text' },
            el('div', { class: 'polozka-nazev' }, k.nazev),
            el('div', { class: 'polozka-popis' }, [typ === 'oboji' ? 'Kniha' : '', k.autor, k.id].filter(Boolean).join(' · '))),
          stavKnihyStitek(k)))));
    }
    seznam.replaceChildren(...(polozky.length ? polozky : [el('li', { class: 'prazdne' }, 'Nic nenalezeno.')]));
  };
  hledani.addEventListener('input', vykresli);
  vykresli();
  otevriDialog(typ === 'pracovnik' ? 'Vyberte pracovníka' : typ === 'kniha' ? 'Vyberte knihu' : 'Vyberte knihu nebo pracovníka', hledani, seznam);
  setTimeout(() => hledani.focus(), 50);
}

function stavKnihyStitek(k) {
  if (!k.aktivni) return el('span', { class: 'stitek sedy' }, 'vyřazená');
  const v = stav.venku.get(k.id);
  if (!v) return el('span', { class: 'stitek volna' }, 'volná');
  return el('span', { class: 'stitek venku', title: `Vypůjčeno: ${jmenoPracovnika(v)}` }, 'vypůjčená');
}

// ---------------------------------------------------------------------------
// Přehled vypůjčených
// ---------------------------------------------------------------------------

function vykresliVypujcene() {
  const q = $('#hledat-vypujcene').value;
  const limit = nastaveni.LIMIT_DNI;
  const vse = stav.otevrene.slice().sort((a, b) => Date.parse(a.vypujceno) - Date.parse(b.vypujceno));
  const dlouhych = vse.filter((v) => dniOd(v.vypujceno) > limit).length;
  const vybrane = vse.filter((v) => odpovida(proHledani(nazevKnihy(v), jmenoPracovnika(v), v.kniha, stav.mapaKnih.get(v.kniha)?.autor), q));
  $('#souhrn-vypujcene').textContent = vse.length
    ? `Vypůjčeno: ${knihText(vse.length)}${dlouhych ? `, z toho ${dlouhych} déle než ${limit} dní` : ''}.`
    : '';
  const polozky = vybrane.map((v) => {
    const dni = dniOd(v.vypujceno);
    const k = stav.mapaKnih.get(v.kniha);
    return el('li', { class: `polozka${dni > limit ? ' dlouha' : ''}` },
      el('div', { class: 'polozka-text klikaci', role: 'button', tabindex: '0', onclick: () => k && detailKnihy(k), onkeydown: (e) => { if (e.key === 'Enter' && k) detailKnihy(k); } },
        el('div', { class: 'polozka-nazev' }, nazevKnihy(v)),
        el('div', { class: 'polozka-popis' }, `${jmenoPracovnika(v)} · od ${datum(v.vypujceno)} · ${dnyText(dni)}`)),
      el('button', { type: 'button', class: 'tlacitko male', onclick: (e) => vratitZSeznamu(e.currentTarget, k || { id: v.kniha, nazev: nazevKnihy(v) }) }, 'Vrátit'));
  });
  $('#seznam-vypujcene').replaceChildren(...(polozky.length ? polozky : [el('li', { class: 'prazdne' }, vse.length ? 'Nic nenalezeno.' : 'Žádná kniha není vypůjčená.')]));
}

async function vratitZSeznamu(tlac, k) {
  if (!confirm(`Vrátit knihu „${k.nazev}“?`)) return;
  tlac.disabled = true;
  try {
    await apiVratit(k);
    toast(`Vráceno: ${k.nazev}`, 'ok');
    prekresli();
  } catch (e) {
    obsluzChybu(e);
    tlac.disabled = false;
    if (e.kod === 'nevypujceno') nacist(true);
  }
}

// ---------------------------------------------------------------------------
// Knihy
// ---------------------------------------------------------------------------

function vykresliKnihy() {
  const q = $('#hledat-knihy').value;
  const filtr = $('#filtr-knihy').value;
  const vybrane = stav.knihy.filter((k) => {
    if (filtr === 'vyrazene') { if (k.aktivni) return false; }
    else if (!k.aktivni) return false;
    if (filtr === 'volne' && stav.venku.has(k.id)) return false;
    if (filtr === 'vypujcene' && !stav.venku.has(k.id)) return false;
    return odpovida(k._h, q);
  }).sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'));
  const aktivnich = stav.knihy.filter((k) => k.aktivni).length;
  $('#souhrn-knihy').textContent = `V evidenci: ${knihText(aktivnich)}` +
    (vybrane.length > MAX_RADKU ? ` · zobrazeno prvních ${MAX_RADKU} z ${vybrane.length}, upřesněte hledání` : '');
  const polozky = vybrane.slice(0, MAX_RADKU).map((k) => {
    const v = stav.venku.get(k.id);
    return el('li', {}, el('button', { type: 'button', class: `polozka${k.aktivni ? '' : ' neaktivni'}`, onclick: () => detailKnihy(k) },
      el('div', { class: 'polozka-text' },
        el('div', { class: 'polozka-nazev' }, k.nazev),
        el('div', { class: 'polozka-popis' }, [k.autor, k.id, v ? `u: ${jmenoPracovnika(v)}` : ''].filter(Boolean).join(' · '))),
      stavKnihyStitek(k)));
  });
  $('#seznam-knihy').replaceChildren(...(polozky.length ? polozky : [el('li', { class: 'prazdne' }, stav.knihy.length ? 'Nic nenalezeno.' : 'Zatím žádné knihy. Správce je přidá v části Správa.')]));
}

function udaje(radky) {
  return el('dl', { class: 'udaje' }, radky.filter(([, h]) => h).map(([n, h]) => [el('dt', {}, n), el('dd', {}, h)]));
}

function sekceHistorie(filtr, popis) {
  const seznam = el('ul', { class: 'historie' }, el('li', { class: 'tlumene' }, 'Načítám…'));
  zavolej('historie', { ...filtr, limit: 100 }).then((r) => {
    if (!seznam.isConnected) return;
    const polozky = r.vypujcky.map((v) => el('li', {},
      el('div', {}, popis(v)),
      el('div', { class: 'tlumene' }, `${datumCas(v.vypujceno)} – ${v.vraceno ? datumCas(v.vraceno) : 'dosud nevráceno'}`)));
    if (r.celkem > r.vypujcky.length) polozky.push(el('li', { class: 'tlumene' }, `… a dalších ${r.celkem - r.vypujcky.length} starších (celá historie je v tabulce).`));
    seznam.replaceChildren(...(polozky.length ? polozky : [el('li', { class: 'tlumene' }, 'Zatím žádné výpůjčky.')]));
  }).catch((e) => {
    seznam.replaceChildren(el('li', { class: 'chyba-text' }, e.message));
  });
  return el('div', { class: 'sekce' }, el('h3', {}, 'Historie výpůjček'), seznam);
}

function detailKnihy(k) {
  const v = stav.venku.get(k.id);
  const akce = el('div', { class: 'radek-tlacitek' });
  if (k.aktivni && v) {
    akce.append(tlacitko('Vrátit', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await apiVratit(k);
        toast(`Vráceno: ${k.nazev}`, 'ok');
        prekresli();
        detailKnihy(k);
      } catch (err) { obsluzChybu(err); e.currentTarget.disabled = false; }
    }, 'hlavni'));
  } else if (k.aktivni) {
    akce.append(tlacitko('Půjčit…', () => vyberDialog('pracovnik', async (p) => {
      try {
        await apiVypujcit(k, p, 'rucne');
        toast(`Vypůjčeno: ${k.nazev} – ${p.jmeno}`, 'ok');
        prekresli();
        detailKnihy(k);
      } catch (err) { obsluzChybu(err); }
    }), 'hlavni'));
  }
  if (jeSpravce()) {
    akce.append(
      tlacitko('Upravit', () => formularKnihy(k)),
      tlacitko('Vytisknout štítek', () => dialogTiskuStitku([k.id])));
  }
  otevriDialog(k.nazev,
    udaje([['ID', k.id], ['Autor', k.autor], ['Vydání', k.vydani], ['ISBN', k.isbn], ['Umístění', k.umisteni], ['Poznámka', k.poznamka]]),
    el('div', { class: 'sekce' },
      !k.aktivni
        ? el('div', { class: 'stav-pruh varovani' }, 'Kniha je vyřazená z evidence.')
        : v
          ? el('div', { class: `stav-pruh ${dniOd(v.vypujceno) > nastaveni.LIMIT_DNI ? 'varovani' : 'ok'}` }, `Vypůjčeno: ${jmenoPracovnika(v)}, od ${datum(v.vypujceno)} (${dnyText(dniOd(v.vypujceno))})`)
          : el('div', { class: 'stav-pruh ok' }, 'Kniha je volná.')),
    akce,
    sekceHistorie({ kniha: k.id }, (h) => jmenoPracovnika(h)));
}

// ---------------------------------------------------------------------------
// Lidé
// ---------------------------------------------------------------------------

function vykresliLide() {
  const q = $('#hledat-lide').value;
  const iNeaktivni = $('#lide-neaktivni').checked;
  const pocty = new Map();
  stav.otevrene.forEach((v) => pocty.set(v.pracovnik, (pocty.get(v.pracovnik) || 0) + 1));
  const vybrani = stav.pracovnici
    .filter((p) => (iNeaktivni || p.aktivni) && odpovida(p._h, q))
    .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'));
  const polozky = vybrani.map((p) => {
    const n = pocty.get(p.id) || 0;
    return el('li', {}, el('button', { type: 'button', class: `polozka${p.aktivni ? '' : ' neaktivni'}`, onclick: () => detailPracovnika(p) },
      el('div', { class: 'polozka-text' },
        el('div', { class: 'polozka-nazev' }, p.jmeno),
        el('div', { class: 'polozka-popis' }, [p.funkce, p.id, p.aktivni ? '' : 'neaktivní'].filter(Boolean).join(' · '))),
      n ? el('span', { class: 'stitek venku' }, knihText(n)) : null));
  });
  $('#seznam-lide').replaceChildren(...(polozky.length ? polozky : [el('li', { class: 'prazdne' }, stav.pracovnici.length ? 'Nic nenalezeno.' : 'Zatím žádní pracovníci. Správce je přidá v části Správa.')]));
}

function detailPracovnika(p) {
  const moje = stav.otevrene.filter((v) => v.pracovnik === p.id);
  const akce = el('div', { class: 'radek-tlacitek' });
  if (p.aktivni) {
    akce.append(tlacitko('Půjčit knihu…', () => vyberDialog('kniha', async (k) => {
      try {
        await apiVypujcit(k, p, 'rucne');
        toast(`Vypůjčeno: ${k.nazev} – ${p.jmeno}`, 'ok');
        prekresli();
        detailPracovnika(p);
      } catch (err) { obsluzChybu(err); }
    }, { jenVolne: true }), 'hlavni'));
  }
  if (jeSpravce()) {
    akce.append(
      tlacitko('Upravit', () => formularPracovnika(p)),
      tlacitko('Vytisknout kartičku', () => dialogTiskuKarticek([p.id])));
  }
  const vypujcene = el('ul', { class: 'seznam' }, moje.length
    ? moje.map((v) => {
      const k = stav.mapaKnih.get(v.kniha) || { id: v.kniha, nazev: nazevKnihy(v) };
      return el('li', { class: 'polozka' },
        el('div', { class: 'polozka-text' },
          el('div', { class: 'polozka-nazev' }, k.nazev),
          el('div', { class: 'polozka-popis' }, `od ${datum(v.vypujceno)} · ${dnyText(dniOd(v.vypujceno))}`)),
        tlacitko('Vrátit', async (e) => {
          e.currentTarget.disabled = true;
          try {
            await apiVratit(k);
            toast(`Vráceno: ${k.nazev}`, 'ok');
            prekresli();
            detailPracovnika(p);
          } catch (err) { obsluzChybu(err); e.currentTarget.disabled = false; }
        }, 'male'));
    })
    : el('li', { class: 'tlumene' }, 'Nemá nic půjčeno.'));
  otevriDialog(p.jmeno,
    udaje([['ID', p.id], ['Funkce', p.funkce], ['Poznámka', p.poznamka], ['Stav', p.aktivni ? '' : 'neaktivní']]),
    el('div', { class: 'sekce' }, el('h3', {}, 'Má vypůjčeno'), vypujcene),
    akce,
    sekceHistorie({ pracovnik: p.id }, (h) => nazevKnihy(h)));
}

// ---------------------------------------------------------------------------
// Správa
// ---------------------------------------------------------------------------

function vykresliSpravu() {
  const info = $('#o-aplikaci');
  info.replaceChildren(
    `Verze ${VERZE}. Přihlášeno jako ${jeSpravce() ? 'správce' : 'pracovník'}. `,
    `V evidenci: ${knihText(stav.knihy.filter((k) => k.aktivni).length)}, pracovníků: ${stav.pracovnici.filter((p) => p.aktivni).length}. `,
    `Data se ukládají do Google tabulky oddělení; tam je i celá historie. `,
    el('br'),
    `Adresa v QR kódech: ${adresaAplikace()}`);
}

function pole(nazev, id, hodnota = '', atributy = {}) {
  return [el('label', { for: id }, nazev), el('input', { id, name: id, type: 'text', value: hodnota, ...atributy })];
}

function formular(titulek, obsah, ulozit) {
  const chyba = el('p', { class: 'chyba-text', role: 'alert' });
  const odeslat = el('button', { type: 'submit', class: 'tlacitko hlavni' }, 'Uložit');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      odeslat.disabled = true;
      chyba.textContent = '';
      try {
        await ulozit(new FormData(form));
      } catch (err) {
        chyba.textContent = err.message;
        if (err.kod === 'neplatny_pin') obsluzChybu(err);
      } finally {
        odeslat.disabled = false;
      }
    },
  }, obsah, chyba, el('div', { class: 'radek-tlacitek' }, odeslat, tlacitko('Zrušit', zavriDialog)));
  otevriDialog(titulek, form);
  setTimeout(() => form.querySelector('input')?.focus(), 50);
}

function nahradNeboPridej(seznam, zaznam) {
  const i = seznam.findIndex((x) => x.id === zaznam.id);
  if (i >= 0) seznam[i] = zaznam;
  else seznam.push(zaznam);
}

function formularKnihy(k = null) {
  formular(k ? `Upravit knihu ${k.id}` : 'Nová kniha', [
    pole('Název *', 'nazev', k?.nazev, { required: true, maxlength: '500' }),
    pole('Autor', 'autor', k?.autor),
    el('div', { class: 'dvojice' },
      el('div', {}, pole('Vydání / rok', 'vydani', k?.vydani)),
      el('div', {}, pole('ISBN', 'isbn', k?.isbn))),
    pole('Umístění', 'umisteni', k?.umisteni, { placeholder: 'např. Knihovna, police 2' }),
    pole('Poznámka', 'poznamka', k?.poznamka),
    k ? el('label', { class: 'zaskrtavatko', style: 'margin-top: 1rem' }, el('input', { type: 'checkbox', name: 'aktivni', checked: k.aktivni }), 'Kniha je v evidenci (zrušte zaškrtnutí pro vyřazení)') : null,
  ], async (fd) => {
    const data = Object.fromEntries(['nazev', 'autor', 'vydani', 'isbn', 'umisteni', 'poznamka'].map((s) => [s, fd.get(s) || '']));
    if (k) {
      data.id = k.id;
      data.aktivni = fd.get('aktivni') === 'on';
      if (!data.aktivni && stav.venku.has(k.id)) throw new Error('Knihu nelze vyřadit, dokud je vypůjčená.');
    }
    const r = await zavolej('ulozitKnihu', data);
    nahradNeboPridej(stav.knihy, r.zaznam);
    preindexuj();
    prekresli();
    toast(k ? 'Kniha uložena.' : `Kniha přidána jako ${r.zaznam.id}.`, 'ok');
    if (k) detailKnihy(r.zaznam);
    else {
      otevriDialog('Kniha přidána',
        objektKnihy(r.zaznam),
        el('p', {}, 'Nezapomeňte knihu označit štítkem s QR kódem.'),
        el('div', { class: 'radek-tlacitek' },
          tlacitko('Vytisknout štítek', () => dialogTiskuStitku([r.zaznam.id]), 'hlavni'),
          tlacitko('Přidat další knihu', () => formularKnihy()),
          tlacitko('Zavřít', zavriDialog)));
    }
  });
}

function formularPracovnika(p = null) {
  formular(p ? `Upravit pracovníka ${p.id}` : 'Nový pracovník', [
    pole('Jméno a příjmení *', 'jmeno', p?.jmeno, { required: true, maxlength: '200', placeholder: 'např. MUDr. Jana Nováková' }),
    pole('Funkce', 'funkce', p?.funkce, { placeholder: 'např. lékařka, sestra…' }),
    pole('Poznámka', 'poznamka', p?.poznamka),
    p ? el('label', { class: 'zaskrtavatko', style: 'margin-top: 1rem' }, el('input', { type: 'checkbox', name: 'aktivni', checked: p.aktivni }), 'Aktivní (zrušte zaškrtnutí, pokud pracovník odešel)') : null,
  ], async (fd) => {
    const data = { jmeno: fd.get('jmeno') || '', funkce: fd.get('funkce') || '', poznamka: fd.get('poznamka') || '' };
    if (p) {
      data.id = p.id;
      data.aktivni = fd.get('aktivni') === 'on';
    }
    const r = await zavolej('ulozitPracovnika', data);
    nahradNeboPridej(stav.pracovnici, r.zaznam);
    preindexuj();
    prekresli();
    toast(p ? 'Pracovník uložen.' : `Pracovník přidán jako ${r.zaznam.id}.`, 'ok');
    if (p) detailPracovnika(r.zaznam);
    else {
      otevriDialog('Pracovník přidán',
        objektPracovnika(r.zaznam),
        el('p', {}, 'Vytiskněte pracovníkovi kartičku s QR kódem.'),
        el('div', { class: 'radek-tlacitek' },
          tlacitko('Vytisknout kartičku', () => dialogTiskuKarticek([r.zaznam.id]), 'hlavni'),
          tlacitko('Přidat dalšího', () => formularPracovnika()),
          tlacitko('Zavřít', zavriDialog)));
    }
  });
}

/** Rozdělí text vložený z Excelu (tabulátory) nebo CSV (středníky) na knihy. */
export function rozeberImport(text) {
  const radky = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!radky.length) return [];
  const oddelovac = radky.some((r) => r.includes('\t')) ? '\t' : ';';
  const bunky = radky.map((r) => r.split(oddelovac).map((s) => s.trim().replace(/^"(.*)"$/, '$1')));
  if (/^n[aá]zev/i.test(bunky[0][0] || '')) bunky.shift();
  return bunky
    .map(([nazev, autor, vydani, isbn, umisteni, poznamka]) => ({ nazev, autor, vydani, isbn, umisteni, poznamka }))
    .filter((k) => k.nazev);
}

function dialogImportu() {
  const pole = el('textarea', { placeholder: 'Název\tAutor\tVydání\tISBN\tUmístění\n…', 'aria-label': 'Data k importu' });
  const nahled = el('p', { class: 'tlumene' }, 'Zatím nic nevloženo.');
  const importovat = el('button', { type: 'button', class: 'tlacitko hlavni', disabled: true }, 'Importovat');
  let knihy = [];
  pole.addEventListener('input', () => {
    knihy = rozeberImport(pole.value);
    importovat.disabled = !knihy.length;
    nahled.textContent = knihy.length
      ? `Rozpoznáno: ${knihText(knihy.length)}. Např.: ${knihy.slice(0, 3).map((k) => `„${k.nazev}“${k.autor ? ` (${k.autor})` : ''}`).join(', ')}${knihy.length > 3 ? ' …' : ''}`
      : 'Nerozpoznána žádná kniha.';
  });
  importovat.addEventListener('click', async () => {
    importovat.disabled = true;
    try {
      const r = await zavolej('importKnih', { knihy });
      r.knihy.forEach((k) => stav.knihy.push(k));
      preindexuj();
      prekresli();
      toast(`Importováno: ${knihText(r.knihy.length)}.`, 'ok');
      otevriDialog('Import dokončen',
        el('p', {}, `Přidáno ${knihText(r.knihy.length)} (${r.knihy[0].id} – ${r.knihy[r.knihy.length - 1].id}).`),
        el('div', { class: 'radek-tlacitek' },
          tlacitko('Vytisknout jejich štítky', () => dialogTiskuStitku(r.knihy.map((k) => k.id)), 'hlavni'),
          tlacitko('Zavřít', zavriDialog)));
    } catch (e) {
      obsluzChybu(e);
      importovat.disabled = false;
    }
  });
  otevriDialog('Hromadný import knih',
    el('p', {}, 'V Excelu označte řádky se sloupci v pořadí ', el('b', {}, 'Název, Autor, Vydání, ISBN, Umístění'), ' (stačí jen Název), zkopírujte je a vložte sem. Řádek s hlavičkou se přeskočí.'),
    pole, nahled, el('div', { class: 'radek-tlacitek' }, importovat, tlacitko('Zrušit', zavriDialog)));
}

/** Seznam se zaškrtávacími políčky pro výběr položek k tisku. */
function vyberKTisku(polozky, popis, predvybrane, priZmene) {
  const vybrane = new Set(predvybrane);
  const hledani = el('input', { type: 'search', placeholder: 'Hledat…', 'aria-label': 'Hledat' });
  const seznam = el('ul', { class: 'vyber-seznam' });
  const souhrn = el('span', { class: 'tlumene' });
  const filtrovane = () => polozky.filter((p) => odpovida(p._h, hledani.value));
  const aktualizuj = () => { souhrn.textContent = `Vybráno: ${vybrane.size}`; priZmene(); };
  const vykresli = () => {
    seznam.replaceChildren(...filtrovane().slice(0, 500).map((p) => el('li', {}, el('label', {},
      el('input', {
        type: 'checkbox', checked: vybrane.has(p.id),
        onchange: (e) => { if (e.target.checked) vybrane.add(p.id); else vybrane.delete(p.id); aktualizuj(); },
      }),
      el('span', {}, popis(p))))));
  };
  hledani.addEventListener('input', vykresli);
  vykresli();
  aktualizuj();
  const element = el('div', {},
    hledani, seznam,
    el('div', { class: 'radek-tlacitek', style: 'align-items: center; margin-top: 0' },
      el('button', { type: 'button', class: 'tlacitko male', onclick: () => { filtrovane().forEach((p) => vybrane.add(p.id)); vykresli(); aktualizuj(); } }, 'Vybrat zobrazené'),
      el('button', { type: 'button', class: 'tlacitko male', onclick: () => { vybrane.clear(); vykresli(); aktualizuj(); } }, 'Zrušit výběr'),
      souhrn));
  return { element, vybrane: () => polozky.filter((p) => vybrane.has(p.id)) };
}

function cisloPole(nazev, id, hodnota, atributy = {}) {
  return el('div', {}, el('label', { for: id }, nazev), el('input', { id, type: 'number', value: String(hodnota), step: '0.5', ...atributy }));
}

function dialogTiskuStitku(predvybrane = []) {
  const ulozene = JSON.parse(uloziste.get('vypujcky.tisk') || '{}');
  const format = el('select', { id: 'tisk-format' }, FORMATY_STITKU.map((f) => el('option', { value: f.id }, f.nazev)));
  format.value = ulozene.format || FORMATY_STITKU[0].id;
  const preskocit = el('input', { type: 'number', min: '0', max: '39', value: '0', id: 'tisk-preskocit' });
  const posunX = cisloPole('Posun vpravo (mm)', 'tisk-x', ulozene.posunX || 0);
  const posunY = cisloPole('Posun dolů (mm)', 'tisk-y', ulozene.posunY || 0);
  const nahled = el('div', { class: 'nahled-tisku' });
  const knihy = stav.knihy.filter((k) => k.aktivni).sort((a, b) => a.id.localeCompare(b.id));
  const tisknout = el('button', { type: 'button', class: 'tlacitko hlavni' }, 'Tisknout');
  const volby = () => ({
    format: format.value,
    preskocit: Number(preskocit.value) || 0,
    posunX: Number(posunX.querySelector('input').value) || 0,
    posunY: Number(posunY.querySelector('input').value) || 0,
  });
  let vyber = null;
  let casovac;
  const naplanujNahled = () => {
    clearTimeout(casovac);
    casovac = setTimeout(() => {
      if (!vyber) return;
      const s = stranyStitku(vyber.vybrane(), volby());
      nahled.replaceChildren(...(s.length ? [s[0]] : [el('p', { class: 'tlumene', style: 'color: #fff' }, 'Vyberte knihy k tisku.')]));
      tisknout.textContent = s.length ? `Tisknout (${s.length} ${s.length === 1 ? 'strana' : s.length < 5 ? 'strany' : 'stran'})` : 'Tisknout';
      tisknout.disabled = !s.length;
    }, 150);
  };
  vyber = vyberKTisku(knihy, (k) => `${k.id} – ${k.nazev}`, predvybrane, naplanujNahled);
  [format, preskocit, posunX, posunY].forEach((x) => x.addEventListener('input', naplanujNahled));
  tisknout.addEventListener('click', () => {
    const v = volby();
    uloziste.set('vypujcky.tisk', JSON.stringify({ format: v.format, posunX: v.posunX, posunY: v.posunY }));
    vytiskni(stranyStitku(vyber.vybrane(), v));
  });
  otevriDialog('Tisk štítků knih',
    vyber.element,
    el('label', { for: 'tisk-format' }, 'Formát etiket'), format,
    el('div', { class: 'dvojice' },
      el('div', {}, el('label', { for: 'tisk-preskocit' }, 'Přeskočit štítků'), preskocit),
      el('div', {})),
    el('div', { class: 'dvojice' }, posunX, posunY),
    el('p', { class: 'tlumene' }, 'Přeskočení se hodí pro načatý arch. V dialogu tisku nastavte měřítko 100 % (bez přizpůsobení stránce) a okraje „žádné“. Posun slouží k doladění, pokud tiskárna tiskne mimo.'),
    el('h3', { style: 'margin: 1rem 0 0.5rem; font-size: 1rem' }, 'Náhled první strany'),
    nahled,
    el('div', { class: 'radek-tlacitek' }, tisknout, tlacitko('Zavřít', zavriDialog)));
}

function dialogTiskuKarticek(predvybrane = []) {
  const lide = stav.pracovnici.filter((p) => p.aktivni).sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'));
  const preskocit = el('input', { type: 'number', min: '0', max: '9', value: '0', id: 'karty-preskocit' });
  const nahled = el('div', { class: 'nahled-tisku' });
  const tisknout = el('button', { type: 'button', class: 'tlacitko hlavni' }, 'Tisknout');
  const obnov = () => {
    const s = stranyKarticek(vyber.vybrane(), { preskocit: preskocit.value });
    nahled.replaceChildren(...(s.length ? [s[0]] : []));
    tisknout.disabled = !s.length;
  };
  const vyber = vyberKTisku(lide, (p) => `${p.jmeno}${p.funkce ? ` (${p.funkce})` : ''}`, predvybrane, () => setTimeout(obnov, 0));
  preskocit.addEventListener('input', obnov);
  tisknout.addEventListener('click', () => vytiskni(stranyKarticek(vyber.vybrane(), { preskocit: preskocit.value })));
  otevriDialog('Tisk kartiček pracovníků',
    vyber.element,
    el('label', { for: 'karty-preskocit' }, 'Přeskočit kartiček'), preskocit,
    el('p', { class: 'tlumene' }, 'Kartičky mají velikost platební karty (85 × 54 mm), 10 na stranu A4. Vystřihněte je podle čárkovaných čar a ideálně zalaminujte. Tiskněte v měřítku 100 %.'),
    el('h3', { style: 'margin: 1rem 0 0.5rem; font-size: 1rem' }, 'Náhled první strany'),
    nahled,
    el('div', { class: 'radek-tlacitek' }, tisknout, tlacitko('Zavřít', zavriDialog)));
}

// ---------------------------------------------------------------------------
// Odkazy z QR kódů (#k=K0042 / #p=P012)
// ---------------------------------------------------------------------------

function zachytOdkaz() {
  const m = /^#([kp])=([A-Za-z0-9]+)$/.exec(location.hash);
  if (!m) return;
  stav.odlozenyKod = m[2];
  history.replaceState(null, '', location.pathname + location.search);
}

function zpracujOdlozeny() {
  if (!stav.odlozenyKod || !stav.role || !stav.nacteno) return;
  const kod = stav.odlozenyKod;
  stav.odlozenyKod = null;
  zpracujKod(kod, 'sken');
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function napojUdalosti() {
  $('#form-prihlaseni').addEventListener('submit', prihlasit);
  document.querySelectorAll('.navigace button').forEach((b) => b.addEventListener('click', () => prepniPohled(b.dataset.pohled)));
  $('#obnovit').addEventListener('click', () => nacist());
  $('#odhlasit').addEventListener('click', () => { if (confirm('Odhlásit toto zařízení? Pro další použití bude potřeba znovu zadat PIN.')) odhlasit(); });
  $('#kamera-prepnout').addEventListener('click', () => prepniKameru());
  $('#rucne').addEventListener('click', () => {
    const krok = stav.tok.krok;
    const typ = krok === 'cekam_pracovnika' ? 'pracovnik' : krok === 'cekam_knihu' ? 'kniha' : 'oboji';
    vyberDialog(typ, (x) => zpracujKod(x.id, 'rucne'));
  });
  $('#hledat-vypujcene').addEventListener('input', vykresliVypujcene);
  $('#hledat-knihy').addEventListener('input', vykresliKnihy);
  $('#filtr-knihy').addEventListener('change', vykresliKnihy);
  $('#hledat-lide').addEventListener('input', vykresliLide);
  $('#lide-neaktivni').addEventListener('change', vykresliLide);
  $('#nova-kniha').addEventListener('click', () => formularKnihy());
  $('#import-knih').addEventListener('click', dialogImportu);
  $('#novy-pracovnik').addEventListener('click', () => formularPracovnika());
  $('#tisk-stitku').addEventListener('click', () => dialogTiskuStitku());
  $('#tisk-karticek').addEventListener('click', () => dialogTiskuKarticek());

  window.addEventListener('hashchange', () => { zachytOdkaz(); zpracujOdlozeny(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      kamera.zastav();
      return;
    }
    if (!stav.role) return;
    if (stav.pohled === 'skenovat') spustKameru();
    if (Date.now() - stav.nacteno > 60 * 1000) nacist(true);
  });

  // pravidelná obnova dat na stále zapnutém zařízení (každých 5 minut, jen když se nic neděje)
  setInterval(() => {
    if (stav.role && !document.hidden && stav.tok.krok === 'start' && !dialog.open) nacist(true);
  }, 5 * 60 * 1000);

  poslouchejCtecku((text) => zpracujKod(text, 'sken'));
  odemkniZvuk();
}

async function start() {
  $('#nazev').textContent = nastaveni.NAZEV;
  napojUdalosti();
  zachytOdkaz();
  if (relace.pin && nastaveni.API_URL) {
    stav.role = relace.role;
    zobrazAplikaci();
    if (await nacist(true)) zpracujOdlozeny();
  } else {
    zobrazPrihlaseni();
  }
}

start();
