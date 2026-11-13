// Testy API (apps-script/Code.gs) nad napodobeninou Google služeb.
// Spuštění: node dev/test-api.mjs

import assert from 'node:assert/strict';
import { vytvorProstredi } from './gas-shim.mjs';

const PIN_U = '111111';
const PIN_S = '999999';
let ok = 0;

function test(nazev, fn) {
  try {
    fn();
    ok++;
    console.log('✓', nazev);
  } catch (err) {
    console.error('✗', nazev);
    console.error(err);
    process.exitCode = 1;
  }
}

function nove() {
  const p = vytvorProstredi();
  p.nastavPin('PIN_UZIVATEL', PIN_U);
  p.nastavPin('PIN_SPRAVCE', PIN_S);
  const u = (akce, data) => p.api({ akce, pin: PIN_U, data });
  const s = (akce, data) => p.api({ akce, pin: PIN_S, data });
  return { p, u, s };
}

test('doGet hlásí nenastavenou aplikaci, dokud nejsou PINy', () => {
  const p = vytvorProstredi();
  assert.equal(p.get().nastaveno, false);
  assert.equal(p.api({ akce: 'nacist', pin: 'x' }).kod, 'nenastaveno');
  p.nastavPin('PIN_UZIVATEL', PIN_U);
  p.nastavPin('PIN_SPRAVCE', PIN_S);
  assert.equal(p.get().nastaveno, true);
});

test('PIN: krátký a shodný PIN se odmítne', () => {
  const p = vytvorProstredi();
  assert.throws(() => p.nastavPin('PIN_UZIVATEL', '123'));
  p.nastavPin('PIN_UZIVATEL', PIN_U);
  assert.throws(() => p.nastavPin('PIN_SPRAVCE', PIN_U));
});

test('přihlášení vrací roli, špatný PIN se odmítne', () => {
  const { p } = nove();
  assert.deepEqual(p.api({ akce: 'prihlasit', pin: PIN_U }), { ok: true, role: 'uzivatel' });
  assert.deepEqual(p.api({ akce: 'prihlasit', pin: PIN_S }), { ok: true, role: 'spravce' });
  assert.equal(p.api({ akce: 'prihlasit', pin: '000000' }).kod, 'neplatny_pin');
  assert.equal(p.api({ akce: 'prihlasit', pin: '' }).kod, 'neplatny_pin');
});

test('po 10 chybných PINech se přihlašování zablokuje', () => {
  const { p } = nove();
  for (let i = 0; i < 10; i++) assert.equal(p.api({ akce: 'prihlasit', pin: 'spatny' + i }).kod, 'neplatny_pin');
  assert.equal(p.api({ akce: 'prihlasit', pin: PIN_U }).kod, 'blokovano');
  p.vymazCache();
  assert.equal(p.api({ akce: 'prihlasit', pin: PIN_U }).role, 'uzivatel');
});

test('uživatel nesmí spravovat, správce ano', () => {
  const { u, s } = nove();
  assert.equal(u('ulozitKnihu', { nazev: 'X' }).kod, 'zakazano');
  const r = s('ulozitKnihu', { nazev: 'Dermatologie', autor: 'Štork' });
  assert.equal(r.ok, true);
  assert.equal(r.zaznam.id, 'K0001');
  assert.equal(r.zaznam.aktivni, true);
});

test('nová kniha bez názvu se odmítne', () => {
  const { s } = nove();
  assert.equal(s('ulozitKnihu', { nazev: '  ' }).kod, 'neplatne');
});

test('listy se založí s hlavičkou, ID se číslují', () => {
  const { s, p } = nove();
  s('ulozitKnihu', { nazev: 'A' });
  s('ulozitKnihu', { nazev: 'B' });
  s('ulozitPracovnika', { jmeno: 'Jana Nováková' });
  const knihy = p.tabulka().getSheetByName('Knihy');
  assert.deepEqual(knihy.getRange(1, 1, 1, 3).getValues()[0], ['id', 'nazev', 'autor']);
  assert.deepEqual(knihy.getRange(2, 1, 2, 1).getValues(), [['K0001'], ['K0002']]);
  assert.equal(p.tabulka().getSheetByName('Pracovnici').getRange(2, 1).getValues()[0][0], 'P001');
});

test('výpůjčka a vrácení', () => {
  const { u, s } = nove();
  s('ulozitKnihu', { nazev: 'Dermatologie' });
  s('ulozitPracovnika', { jmeno: 'Jana Nováková' });
  const v = u('vypujcit', { kniha: 'k0001', pracovnik: 'P001', zpusob: 'sken' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.vypujcka.kniha, 'K0001');
  assert.equal(v.vypujcka.jmenoPracovnika, 'Jana Nováková');
  assert.equal(v.vypujcka.vraceno, null);
  assert.ok(Date.parse(v.vypujcka.vypujceno));

  let data = u('nacist');
  assert.equal(data.otevrene.length, 1);

  assert.equal(u('vypujcit', { kniha: 'K0001', pracovnik: 'P001' }).kod, 'jiz_vypujceno');

  const r = u('vratit', { kniha: 'K0001' });
  assert.equal(r.ok, true);
  assert.ok(Date.parse(r.vypujcka.vraceno));
  assert.equal(u('nacist').otevrene.length, 0);
  assert.equal(u('vratit', { kniha: 'K0001' }).kod, 'nevypujceno');

  // znovu půjčit lze
  assert.equal(u('vypujcit', { kniha: 'K0001', pracovnik: 'P001', zpusob: 'rucne' }).vypujcka.id, 'V000002');
});

test('nelze půjčit neexistující nebo vyřazenou knihu či deaktivovaného pracovníka', () => {
  const { u, s } = nove();
  s('ulozitKnihu', { nazev: 'A' });
  s('ulozitPracovnika', { jmeno: 'B' });
  assert.equal(u('vypujcit', { kniha: 'K0099', pracovnik: 'P001' }).kod, 'nenalezeno');
  assert.equal(u('vypujcit', { kniha: 'K0001', pracovnik: 'P099' }).kod, 'nenalezeno');
  s('ulozitKnihu', { id: 'K0001', aktivni: false });
  assert.equal(u('vypujcit', { kniha: 'K0001', pracovnik: 'P001' }).kod, 'neaktivni');
  s('ulozitKnihu', { id: 'K0001', aktivni: true });
  s('ulozitPracovnika', { id: 'P001', aktivni: false });
  assert.equal(u('vypujcit', { kniha: 'K0001', pracovnik: 'P001' }).kod, 'neaktivni');
});

test('úprava knihy mění jen zadaná pole', () => {
  const { s, u } = nove();
  s('ulozitKnihu', { nazev: 'Původní', autor: 'Autor', isbn: '978-80' });
  const r = s('ulozitKnihu', { id: 'K0001', nazev: 'Nový název' });
  assert.equal(r.zaznam.nazev, 'Nový název');
  assert.equal(r.zaznam.autor, 'Autor');
  assert.equal(s('ulozitKnihu', { id: 'K0001', nazev: '' }).kod, 'neplatne');
  assert.equal(s('ulozitKnihu', { id: 'K0404', nazev: 'x' }).kod, 'nenalezeno');
  assert.equal(u('nacist').knihy[0].isbn, '978-80');
});

test('text začínající = se neuloží jako vzorec', () => {
  const { s, p } = nove();
  s('ulozitKnihu', { nazev: '=HYPERLINK("x")' });
  assert.equal(p.tabulka().getSheetByName('Knihy').getRange(2, 2).getValues()[0][0], '=HYPERLINK("x")');
});

test('hromadný import knih', () => {
  const { s, u } = nove();
  s('ulozitKnihu', { nazev: 'Existující' });
  const r = s('importKnih', { knihy: [{ nazev: 'A', autor: 'X' }, { nazev: '' }, { nazev: 'B', vydani: '2019' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.knihy.map((k) => k.id), ['K0002', 'K0003']);
  assert.equal(u('nacist').knihy.length, 3);
  assert.equal(s('importKnih', { knihy: [] }).kod, 'neplatne');
});

test('historie podle knihy a pracovníka, nejnovější první', () => {
  const { s, u } = nove();
  s('importKnih', { knihy: [{ nazev: 'A' }, { nazev: 'B' }] });
  s('ulozitPracovnika', { jmeno: 'P1' });
  s('ulozitPracovnika', { jmeno: 'P2' });
  u('vypujcit', { kniha: 'K0001', pracovnik: 'P001' });
  u('vratit', { kniha: 'K0001' });
  u('vypujcit', { kniha: 'K0001', pracovnik: 'P002' });
  u('vypujcit', { kniha: 'K0002', pracovnik: 'P001' });
  const hk = u('historie', { kniha: 'K0001' });
  assert.equal(hk.celkem, 2);
  assert.deepEqual(hk.vypujcky.map((v) => v.id), ['V000002', 'V000001']);
  const hp = u('historie', { pracovnik: 'P001' });
  assert.deepEqual(hp.vypujcky.map((v) => v.kniha).sort(), ['K0001', 'K0002']);
});

test('přidání řádků za hranici listu list rozšíří', () => {
  const { s, p } = nove();
  s('ulozitKnihu', { nazev: 'A' });
  const list = p.tabulka().getSheetByName('Knihy');
  list.maxRows = 3;
  const r = s('importKnih', { knihy: Array.from({ length: 10 }, (_, i) => ({ nazev: 'N' + i })) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(list.getLastRow(), 12);
});

test('ručně přidané sloupce a přeházené pořadí v tabulce nevadí', () => {
  const { s, u, p } = nove();
  s('ulozitKnihu', { nazev: 'A', autor: 'X' });
  const list = p.tabulka().getSheetByName('Knihy');
  // prohodit sloupce nazev a autor a přidat vlastní sloupec
  const data = list.getRange(1, 1, 2, 9).getValues();
  data.forEach((r) => { [r[1], r[2]] = [r[2], r[1]]; });
  list.getRange(1, 1, 2, 9).setValues(data);
  list.getRange(1, 10).setValue('moje_poznamka');
  const k = u('nacist').knihy[0];
  assert.equal(k.nazev, 'A');
  assert.equal(k.autor, 'X');
  s('ulozitKnihu', { nazev: 'B' });
  assert.equal(u('nacist').knihy[1].nazev, 'B');
});

test('neznámá akce a poškozený požadavek', () => {
  const { u, p } = nove();
  assert.equal(u('smazatVse').kod, 'neznama_akce');
  const r = JSON.parse(p.kontext.doPost({ postData: { contents: '{nejson' } }).getContent());
  assert.equal(r.kod, 'spatny_pozadavek');
});

console.log(`\n${ok} testů prošlo${process.exitCode ? ', některé SELHALY' : ''}.`);
