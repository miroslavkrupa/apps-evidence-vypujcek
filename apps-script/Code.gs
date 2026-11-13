/**
 * Evidence výpůjček – Kožní oddělení FN Ostrava
 * API nad Google tabulkou (Google Apps Script, runtime V8).
 *
 * Skript je vázaný na tabulku (Rozšíření → Apps Script).
 * Nasazení: Nasadit → Nové nasazení → Webová aplikace,
 *           Spustit jako: já, Přístup: kdokoli.
 *
 * Webová aplikace volá doPost s tělem (text/plain) ve tvaru JSON:
 *   { "akce": "vypujcit", "pin": "...", "data": { ... } }
 * Odpověď: { "ok": true, ... } nebo { "ok": false, "kod": "...", "chyba": "text pro uživatele" }
 */

var VERZE_API = 1;

var LISTY = {
  knihy: {
    nazev: 'Knihy',
    sloupce: ['id', 'nazev', 'autor', 'vydani', 'isbn', 'umisteni', 'poznamka', 'aktivni', 'vytvoreno'],
    datumy: ['vytvoreno']
  },
  pracovnici: {
    nazev: 'Pracovnici',
    sloupce: ['id', 'jmeno', 'funkce', 'poznamka', 'aktivni', 'vytvoreno'],
    datumy: ['vytvoreno']
  },
  vypujcky: {
    nazev: 'Vypujcky',
    sloupce: ['id', 'kniha_id', 'pracovnik_id', 'vypujceno', 'vraceno', 'zpusob', 'poznamka', 'nazev_knihy', 'jmeno_pracovnika'],
    datumy: ['vypujceno', 'vraceno']
  }
};

var PREFIX = { knihy: 'K', pracovnici: 'P', vypujcky: 'V' };
var DELKA_ID = { knihy: 4, pracovnici: 3, vypujcky: 6 };

var MAX_CHYBNYCH_PINU = 10;
var BLOKACE_SEKUND = 15 * 60;
var MIN_DELKA_PINU = 6;
var POCET_ZALOH = 24;
var NAZEV_SLOZKY_ZALOH = 'Zálohy – evidence výpůjček';

// ---------------------------------------------------------------------------
// Vstupní body webové aplikace
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, sluzba: 'evidence-vypujcek', verze: VERZE_API, nastaveno: jeNastaveno_() });
}

function doPost(e) {
  var pozadavek;
  try {
    pozadavek = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_(chyba_('spatny_pozadavek', 'Neplatný požadavek.'));
  }
  try {
    return json_(zpracuj_(pozadavek));
  } catch (err) {
    if (err && err.kodChyby) return json_(chyba_(err.kodChyby, err.message));
    console.error(err && err.stack ? err.stack : err);
    return json_(chyba_('interni', 'Chyba serveru: ' + (err && err.message ? err.message : err)));
  }
}

function zpracuj_(p) {
  var akce = String(p.akce || '');
  var data = p.data || {};
  if (!jeNastaveno_()) throw new Chyba_('nenastaveno', 'Aplikace ještě není nastavená (chybí PINy). Viz návod k instalaci.');

  var role = overPin_(String(p.pin || ''));

  switch (akce) {
    case 'prihlasit': return { ok: true, role: role };
    case 'nacist': return nacist_();
    case 'vypujcit': return sZamkem_(function () { return vypujcit_(data); });
    case 'vratit': return sZamkem_(function () { return vratit_(data); });
    case 'historie': return historie_(data);
    case 'ulozitKnihu': vyzadujSpravce_(role); return sZamkem_(function () { return ulozit_('knihy', data); });
    case 'ulozitPracovnika': vyzadujSpravce_(role); return sZamkem_(function () { return ulozit_('pracovnici', data); });
    case 'importKnih': vyzadujSpravce_(role); return sZamkem_(function () { return importKnih_(data); });
    default: throw new Chyba_('neznama_akce', 'Neznámá akce: ' + akce);
  }
}

// ---------------------------------------------------------------------------
// Akce
// ---------------------------------------------------------------------------

function nacist_() {
  var knihy = nactiList_('knihy');
  var pracovnici = nactiList_('pracovnici');
  var otevrene = nactiList_('vypujcky').filter(function (v) { return !v.vraceno; });
  return {
    ok: true,
    cas: new Date().toISOString(),
    knihy: knihy.map(verejnaKniha_),
    pracovnici: pracovnici.map(verejnyPracovnik_),
    otevrene: otevrene.map(verejnaVypujcka_)
  };
}

function vypujcit_(d) {
  var knihaId = normalizujId_(d.kniha);
  var pracId = normalizujId_(d.pracovnik);
  var kniha = najdi_(nactiList_('knihy'), knihaId);
  if (!kniha) throw new Chyba_('nenalezeno', 'Kniha ' + knihaId + ' neexistuje.');
  if (!jeAktivni_(kniha)) throw new Chyba_('neaktivni', 'Kniha ' + knihaId + ' je vyřazená.');
  var prac = najdi_(nactiList_('pracovnici'), pracId);
  if (!prac) throw new Chyba_('nenalezeno', 'Pracovník ' + pracId + ' neexistuje.');
  if (!jeAktivni_(prac)) throw new Chyba_('neaktivni', 'Pracovník ' + prac.jmeno + ' je deaktivovaný.');

  var vypujcky = nactiList_('vypujcky');
  var otevrena = otevrenaProKnihu_(vypujcky, knihaId);
  if (otevrena) {
    var drzitel = otevrena.pracovnik_id === pracId ? 'již u tohoto pracovníka' : 'u ' + (otevrena.jmeno_pracovnika || otevrena.pracovnik_id);
    throw new Chyba_('jiz_vypujceno', 'Kniha je ' + drzitel + '. Nejprve ji vraťte.');
  }

  var zaznam = {
    id: dalsiId_('vypujcky', vypujcky),
    kniha_id: knihaId,
    pracovnik_id: pracId,
    vypujceno: new Date(),
    vraceno: '',
    zpusob: d.zpusob === 'rucne' ? 'rucne' : 'sken',
    poznamka: text_(d.poznamka, 500),
    nazev_knihy: kniha.nazev,
    jmeno_pracovnika: prac.jmeno
  };
  pripojRadky_('vypujcky', [zaznam]);
  return { ok: true, vypujcka: verejnaVypujcka_(zaznam) };
}

function vratit_(d) {
  var knihaId = normalizujId_(d.kniha);
  var vypujcky = nactiList_('vypujcky');
  var otevrene = vypujcky.filter(function (v) { return v.kniha_id === knihaId && !v.vraceno; });
  if (!otevrene.length) throw new Chyba_('nevypujceno', 'Kniha ' + knihaId + ' není vypůjčená.');
  var ted = new Date();
  var list = list_('vypujcky');
  var mapa = mapaSloupcu_(list);
  otevrene.forEach(function (v) {
    list.getRange(v._radek, mapa.vraceno + 1).setValue(ted);
    v.vraceno = ted;
  });
  return { ok: true, vypujcka: verejnaVypujcka_(otevrene[otevrene.length - 1]) };
}

function historie_(d) {
  var knihaId = d.kniha ? normalizujId_(d.kniha) : null;
  var pracId = d.pracovnik ? normalizujId_(d.pracovnik) : null;
  var limit = Math.min(Number(d.limit) || 200, 1000);
  var vysledek = nactiList_('vypujcky').filter(function (v) {
    return (!knihaId || v.kniha_id === knihaId) && (!pracId || v.pracovnik_id === pracId);
  });
  vysledek.sort(function (a, b) { return (cas_(b.vypujceno) - cas_(a.vypujceno)) || (b._radek - a._radek); });
  return { ok: true, celkem: vysledek.length, vypujcky: vysledek.slice(0, limit).map(verejnaVypujcka_) };
}

function ulozit_(typ, d) {
  var povinne = typ === 'knihy' ? 'nazev' : 'jmeno';
  var hodnoty = {};
  LISTY[typ].sloupce.forEach(function (s) {
    if (s === 'id' || s === 'vytvoreno' || s === 'aktivni') return;
    if (d[s] !== undefined) hodnoty[s] = text_(d[s], 500);
  });
  if (d.aktivni !== undefined) hodnoty.aktivni = d.aktivni === false || d.aktivni === 'NE' ? 'NE' : 'ANO';

  var zaznamy = nactiList_(typ);
  if (d.id) {
    var id = normalizujId_(d.id);
    var puvodni = najdi_(zaznamy, id);
    if (!puvodni) throw new Chyba_('nenalezeno', 'Záznam ' + id + ' neexistuje.');
    if (hodnoty[povinne] !== undefined && !hodnoty[povinne]) throw new Chyba_('neplatne', 'Pole „' + povinne + '“ je povinné.');
    var list = list_(typ);
    var mapa = mapaSloupcu_(list);
    Object.keys(hodnoty).forEach(function (s) {
      if (mapa[s] === undefined) return;
      list.getRange(puvodni._radek, mapa[s] + 1).setValue(bezpecnaHodnota_(hodnoty[s]));
      puvodni[s] = hodnoty[s];
    });
    return { ok: true, zaznam: typ === 'knihy' ? verejnaKniha_(puvodni) : verejnyPracovnik_(puvodni) };
  }

  if (!hodnoty[povinne]) throw new Chyba_('neplatne', 'Pole „' + povinne + '“ je povinné.');
  var novy = hodnoty;
  novy.id = dalsiId_(typ, zaznamy);
  novy.aktivni = novy.aktivni || 'ANO';
  novy.vytvoreno = new Date();
  pripojRadky_(typ, [novy]);
  return { ok: true, zaznam: typ === 'knihy' ? verejnaKniha_(novy) : verejnyPracovnik_(novy) };
}

function importKnih_(d) {
  var vstup = Array.isArray(d.knihy) ? d.knihy : [];
  if (!vstup.length) throw new Chyba_('neplatne', 'Žádné knihy k importu.');
  if (vstup.length > 2000) throw new Chyba_('neplatne', 'Najednou lze importovat nejvýše 2000 knih.');
  var zaznamy = nactiList_('knihy');
  var dalsi = dalsiCislo_('knihy', zaznamy);
  var ted = new Date();
  var nove = [];
  vstup.forEach(function (k) {
    var nazev = text_(k.nazev, 500);
    if (!nazev) return;
    nove.push({
      id: formatujId_('knihy', dalsi++),
      nazev: nazev,
      autor: text_(k.autor, 500),
      vydani: text_(k.vydani, 500),
      isbn: text_(k.isbn, 500),
      umisteni: text_(k.umisteni, 500),
      poznamka: text_(k.poznamka, 500),
      aktivni: 'ANO',
      vytvoreno: ted
    });
  });
  if (!nove.length) throw new Chyba_('neplatne', 'Žádný řádek neobsahoval název knihy.');
  pripojRadky_('knihy', nove);
  return { ok: true, knihy: nove.map(verejnaKniha_) };
}

// ---------------------------------------------------------------------------
// PIN a oprávnění
// ---------------------------------------------------------------------------

function overPin_(pin) {
  var cache = CacheService.getScriptCache();
  var chybne = Number(cache.get('chybne_piny') || 0);
  if (chybne >= MAX_CHYBNYCH_PINU) {
    throw new Chyba_('blokovano', 'Příliš mnoho chybných PINů. Zkuste to znovu za 15 minut.');
  }
  var props = PropertiesService.getScriptProperties();
  var sul = props.getProperty('PIN_SUL') || '';
  var h = hash_(sul + pin);
  if (pin && h === props.getProperty('PIN_SPRAVCE')) return 'spravce';
  if (pin && h === props.getProperty('PIN_UZIVATEL')) return 'uzivatel';
  cache.put('chybne_piny', String(chybne + 1), BLOKACE_SEKUND);
  throw new Chyba_('neplatny_pin', 'Neplatný PIN.');
}

function vyzadujSpravce_(role) {
  if (role !== 'spravce') throw new Chyba_('zakazano', 'Tuto akci může provést jen správce.');
}

function jeNastaveno_() {
  var props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('PIN_UZIVATEL') && props.getProperty('PIN_SPRAVCE'));
}

function nastavPin_(klic, pin) {
  pin = String(pin || '').trim();
  if (pin.length < MIN_DELKA_PINU) throw new Error('PIN musí mít alespoň ' + MIN_DELKA_PINU + ' znaků.');
  var props = PropertiesService.getScriptProperties();
  var sul = props.getProperty('PIN_SUL');
  if (!sul) {
    sul = Utilities.getUuid();
    props.setProperty('PIN_SUL', sul);
  }
  var jiny = klic === 'PIN_SPRAVCE' ? 'PIN_UZIVATEL' : 'PIN_SPRAVCE';
  if (props.getProperty(jiny) === hash_(sul + pin)) throw new Error('PIN pro pracovníky a PIN správce se musí lišit.');
  props.setProperty(klic, hash_(sul + pin));
  CacheService.getScriptCache().remove('chybne_piny');
}

function hash_(s) {
  var bajty = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bajty.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ---------------------------------------------------------------------------
// Práce s tabulkou
// ---------------------------------------------------------------------------

function list_(typ) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var list = ss.getSheetByName(LISTY[typ].nazev);
  if (!list) list = pripravList_(ss, typ);
  return list;
}

/** Vrátí mapu název sloupce → index (0..n) podle hlavičky; chybějící sloupce doplní. */
function mapaSloupcu_(list) {
  var typ = typPodleListu_(list);
  var posledni = Math.max(list.getLastColumn(), 1);
  var hlavicka = list.getRange(1, 1, 1, posledni).getValues()[0].map(function (h) { return String(h).trim(); });
  var mapa = {};
  hlavicka.forEach(function (h, i) { if (h && mapa[h] === undefined) mapa[h] = i; });
  LISTY[typ].sloupce.forEach(function (s) {
    if (mapa[s] === undefined) {
      var sloupec = hlavicka.length + 1;
      if (sloupec > list.getMaxColumns()) list.insertColumnsAfter(list.getMaxColumns(), 1);
      list.getRange(1, sloupec).setValue(s);
      hlavicka.push(s);
      mapa[s] = sloupec - 1;
    }
  });
  return mapa;
}

function typPodleListu_(list) {
  var nazev = list.getName();
  for (var typ in LISTY) if (LISTY[typ].nazev === nazev) return typ;
  throw new Error('Neznámý list ' + nazev);
}

/** Načte všechny řádky listu jako objekty; _radek = číslo řádku v tabulce (1 = hlavička). */
function nactiList_(typ) {
  var list = list_(typ);
  var mapa = mapaSloupcu_(list);
  var posledniRadek = list.getLastRow();
  if (posledniRadek < 2) return [];
  var hodnoty = list.getRange(2, 1, posledniRadek - 1, Math.max(list.getLastColumn(), 1)).getValues();
  var vysledek = [];
  hodnoty.forEach(function (radek, i) {
    var o = { _radek: i + 2 };
    Object.keys(mapa).forEach(function (s) { o[s] = radek[mapa[s]]; });
    if (!String(o.id || '').trim()) return; // prázdný řádek
    o.id = normalizujId_(o.id);
    if (o.kniha_id !== undefined) o.kniha_id = normalizujId_(o.kniha_id);
    if (o.pracovnik_id !== undefined) o.pracovnik_id = normalizujId_(o.pracovnik_id);
    vysledek.push(o);
  });
  return vysledek;
}

function pripojRadky_(typ, zaznamy) {
  var list = list_(typ);
  var mapa = mapaSloupcu_(list);
  var sirka = Math.max(list.getLastColumn(), 1);
  var radky = zaznamy.map(function (z) {
    var r = [];
    for (var i = 0; i < sirka; i++) r.push('');
    Object.keys(mapa).forEach(function (s) {
      if (z[s] !== undefined && z[s] !== null) r[mapa[s]] = bezpecnaHodnota_(z[s]);
    });
    return r;
  });
  var start = list.getLastRow() + 1;
  var chybi = start + radky.length - 1 - list.getMaxRows();
  if (chybi > 0) list.insertRowsAfter(list.getMaxRows(), chybi + 100);
  list.getRange(start, 1, radky.length, sirka).setValues(radky);
  zaznamy.forEach(function (z, i) { z._radek = start + i; });
}

function sZamkem_(fn) {
  var zamek = LockService.getScriptLock();
  if (!zamek.tryLock(20000)) throw new Chyba_('zaneprazdneno', 'Server je zaneprázdněn, zkuste to prosím znovu.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    zamek.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

function Chyba_(kod, zprava) {
  this.kodChyby = kod;
  this.message = zprava;
}

function chyba_(kod, zprava) {
  return { ok: false, kod: kod, chyba: zprava };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function normalizujId_(id) {
  return String(id || '').trim().toUpperCase();
}

function najdi_(zaznamy, id) {
  for (var i = 0; i < zaznamy.length; i++) if (zaznamy[i].id === id) return zaznamy[i];
  return null;
}

function otevrenaProKnihu_(vypujcky, knihaId) {
  for (var i = vypujcky.length - 1; i >= 0; i--) {
    if (vypujcky[i].kniha_id === knihaId && !vypujcky[i].vraceno) return vypujcky[i];
  }
  return null;
}

function jeAktivni_(z) {
  return String(z.aktivni || 'ANO').trim().toUpperCase() !== 'NE';
}

function dalsiCislo_(typ, zaznamy) {
  var max = 0;
  zaznamy.forEach(function (z) {
    var m = /^[A-Z]+(\d+)$/.exec(z.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

function dalsiId_(typ, zaznamy) {
  return formatujId_(typ, dalsiCislo_(typ, zaznamy));
}

function formatujId_(typ, cislo) {
  var s = String(cislo);
  while (s.length < DELKA_ID[typ]) s = '0' + s;
  return PREFIX[typ] + s;
}

function jeDatum_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function iso_(v) {
  if (jeDatum_(v)) return v.toISOString();
  return v ? String(v) : null;
}

function cas_(v) {
  if (jeDatum_(v)) return v.getTime();
  var t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

function text_(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max || 500);
}

/** Zabrání tomu, aby tabulka text začínající „=“ apod. vyhodnotila jako vzorec. */
function bezpecnaHodnota_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function retezec_(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function verejnaKniha_(k) {
  return {
    id: k.id, nazev: retezec_(k.nazev), autor: retezec_(k.autor), vydani: retezec_(k.vydani),
    isbn: retezec_(k.isbn), umisteni: retezec_(k.umisteni), poznamka: retezec_(k.poznamka),
    aktivni: jeAktivni_(k)
  };
}

function verejnyPracovnik_(p) {
  return {
    id: p.id, jmeno: retezec_(p.jmeno), funkce: retezec_(p.funkce), poznamka: retezec_(p.poznamka),
    aktivni: jeAktivni_(p)
  };
}

function verejnaVypujcka_(v) {
  return {
    id: v.id, kniha: v.kniha_id, pracovnik: v.pracovnik_id,
    vypujceno: iso_(v.vypujceno), vraceno: iso_(v.vraceno),
    zpusob: retezec_(v.zpusob), poznamka: retezec_(v.poznamka),
    nazevKnihy: retezec_(v.nazev_knihy), jmenoPracovnika: retezec_(v.jmeno_pracovnika)
  };
}

// ---------------------------------------------------------------------------
// Příprava tabulky, menu a zálohy (spouští správce z tabulky)
// ---------------------------------------------------------------------------

function pripravList_(ss, typ) {
  var def = LISTY[typ];
  var list = ss.getSheetByName(def.nazev) || ss.insertSheet(def.nazev);
  if (list.getLastRow() === 0) {
    list.getRange(1, 1, 1, def.sloupce.length).setValues([def.sloupce]);
  }
  list.setFrozenRows(1);
  list.getRange(1, 1, 1, def.sloupce.length).setFontWeight('bold');
  // Textové sloupce jako prostý text (aby se „2019“ nebo „0042“ nepřevedlo na číslo),
  // datumové sloupce ve formátu data a času.
  if (list.getMaxRows() < 1000) list.insertRowsAfter(list.getMaxRows(), 1000 - list.getMaxRows());
  def.sloupce.forEach(function (s, i) {
    var format = def.datumy.indexOf(s) >= 0 ? 'd.M.yyyy H:mm' : '@';
    list.getRange(2, i + 1, list.getMaxRows() - 1, 1).setNumberFormat(format);
  });
  return list;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Evidence výpůjček')
    .addItem('1. Připravit listy', 'menuPripravitListy')
    .addItem('2. Nastavit PIN pro pracovníky', 'menuPinUzivatel')
    .addItem('3. Nastavit PIN správce', 'menuPinSpravce')
    .addItem('4. Zapnout měsíční zálohy', 'menuZapnoutZalohy')
    .addSeparator()
    .addItem('Zálohovat teď', 'zalohovat')
    .addItem('Zrušit blokaci PINů', 'menuZrusitBlokaci')
    .addToUi();
}

function menuPripravitListy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(LISTY).forEach(function (typ) { pripravList_(ss, typ); });
  var prazdny = ss.getSheetByName('List 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('List1');
  if (prazdny && prazdny.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(prazdny);
  SpreadsheetApp.getUi().alert('Listy Knihy, Pracovnici a Vypujcky jsou připravené.');
}

function menuPinUzivatel() { menuPin_('PIN_UZIVATEL', 'PIN pro pracovníky (výpůjčky a vrácení)'); }
function menuPinSpravce() { menuPin_('PIN_SPRAVCE', 'PIN správce (přidávání knih a pracovníků, tisk)'); }

function menuPin_(klic, popis) {
  var ui = SpreadsheetApp.getUi();
  var odpoved = ui.prompt(popis, 'Zadejte nový PIN (alespoň ' + MIN_DELKA_PINU + ' znaků):', ui.ButtonSet.OK_CANCEL);
  if (odpoved.getSelectedButton() !== ui.Button.OK) return;
  try {
    nastavPin_(klic, odpoved.getResponseText());
    ui.alert('PIN byl nastaven. Zařízení přihlášená starým PINem se budou muset přihlásit znovu.');
  } catch (err) {
    ui.alert('PIN nebyl nastaven: ' + err.message);
  }
}

function menuZrusitBlokaci() {
  CacheService.getScriptCache().remove('chybne_piny');
  SpreadsheetApp.getUi().alert('Blokace přihlašování byla zrušena.');
}

function menuZapnoutZalohy() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'zalohovat') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('zalohovat').timeBased().onMonthDay(1).atHour(3).create();
  zalohovat();
  SpreadsheetApp.getUi().alert('Měsíční zálohy jsou zapnuté (1. den v měsíci). První záloha byla právě vytvořena ve složce „' + NAZEV_SLOZKY_ZALOH + '“ na Google Disku.');
}

/** Vytvoří kopii tabulky do složky záloh a ponechá posledních POCET_ZALOH kopií. */
function zalohovat() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var slozky = DriveApp.getFoldersByName(NAZEV_SLOZKY_ZALOH);
  var slozka = slozky.hasNext() ? slozky.next() : DriveApp.createFolder(NAZEV_SLOZKY_ZALOH);
  var datum = Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy('Záloha ' + datum + ' – ' + ss.getName(), slozka);

  var soubory = [];
  var it = slozka.getFiles();
  while (it.hasNext()) soubory.push(it.next());
  soubory.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  soubory.slice(POCET_ZALOH).forEach(function (f) { f.setTrashed(true); });
}
