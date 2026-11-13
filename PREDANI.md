# Předání vývojáři

Stav k 13. 11. 2026. Tento dokument shrnuje, co je hotové, co ověřené není, jaká rozhodnutí
zbývají a co je potřeba udělat do ostrého provozu. Podrobný návrh je v [NAVRH.md](NAVRH.md).

## 1. O co jde

Evidence výpůjček knih z příruční knihovny Kožního oddělení FN Ostrava.
Výpůjčka = naskenovat QR kód knihy a kartičku pracovníka, vrácení = naskenovat knihu.

Požadavky zadavatele (závazné):

- **nulové nebo jednorázové náklady**, žádné předplatné,
- **bez součinnosti IT FN Ostrava**, hostované na internetu,
- **provoz po řadu let s minimální údržbou** → žádný build, žádné npm závislosti v provozu,
  knihovny zkopírované v repozitáři, data v Google tabulce čitelné i bez aplikace.

## 2. Architektura v kostce

```
prohlížeč (telefon / tablet / PC)
  └─ statický web  web/            čisté HTML + CSS + JS (ES moduly), bez frameworku
       └─ POST text/plain JSON  →  Google Apps Script  apps-script/Code.gs  (doPost)
                                     └─ Google tabulka: listy Knihy | Pracovnici | Vypujcky
```

- Požadavky jdou jako `text/plain`, aby prohlížeč neposílal CORS preflight (Apps Script ho neumí).
- Každý požadavek nese PIN. Dva PINy: pracovník / správce. V Apps Scriptu uložené jako
  SHA-256 se solí ve Script Properties.
- Zápisy běží pod `LockService`. Sloupce se hledají podle názvu v hlavičce.
- QR kód obsahuje `<adresa aplikace>#k=K0042` / `#p=P012`. Skener vždy bere jen koncové ID,
  takže štítky fungují i po změně adresy.

| Soubor | Obsah |
|---|---|
| `web/app.js` | stav aplikace, obrazovky, průběh výpůjčky/vrácení (stavový automat `stav.tok`) |
| `web/api.js` | `zavolej(akce, data)`, uložení PINu v `localStorage` |
| `web/skener.js` | kamera (`BarcodeDetector`, jinak jsQR), USB čtečka (vč. převodu české klávesnice), `rozpoznejKod()` |
| `web/tisk.js` | štítky (formáty etiket) a kartičky, SVG QR kódy, tisk přes `window.print()` |
| `web/config.js` | jediné místo konfigurace: `API_URL`, názvy, `LIMIT_DNI`, `APP_URL` |
| `apps-script/Code.gs` | API, PINy, menu v tabulce, měsíční zálohy |
| `dev/server.mjs` | lokální server: servíruje `web/` a na `/api` spouští skutečný `Code.gs` nad napodobeninou tabulky |
| `dev/gas-shim.mjs` | napodobenina SpreadsheetApp, LockService, CacheService, PropertiesService, Utilities, ContentService |
| `dev/test-api.mjs` | 16 testů API |

## 3. Spuštění u sebe

Stačí Node.js 18+ (nic se neinstaluje):

```bash
node dev/server.mjs        # http://localhost:8080/  PIN pracovníci 111111, správce 999999
node dev/test-api.mjs      # testy API
```

Ukázková data se založí do `dev/data.json` (smazáním se obnoví). Kamera funguje jen na
`https://` nebo `localhost`. Simulace USB čtečky v konzoli prohlížeče: rychle odeslané
`keydown` události zakončené `Enter`.

## 4. Co je hotové a ověřené

Ověřeno lokálně (dev server + prohlížeč, desktop i mobilní šířka, světlý i tmavý režim):

- přihlášení, role (správce vidí záložku Správa), chybný PIN,
- výpůjčka skenem v libovolném pořadí (kniha → pracovník i naopak), vrácení,
  „Další kniha pro …“, ruční výběr ze seznamu,
- USB čtečka včetně české klávesnice (`+ěščřžýáíé` → číslice),
- otevření aplikace z URL `#k=K0006` (QR naskenovaný fotoaparátem telefonu),
- přehledy Vypůjčené / Knihy / Lidé, detaily s historií, zvýraznění dlouhých výpůjček,
- přidání a úprava knihy a pracovníka, hromadný import z Excelu (tabulátory / středníky),
- náhled tisku štítků a kartiček; vygenerované QR kódy se zpětně přečtou (jsQR),
- API: 16 automatických testů (PINy a blokace, oprávnění, výpůjčka/vrácení, konflikty,
  import, historie, rozšíření listu, přeházené sloupce, ochrana proti vzorcům).

## 5. Co ověřené NENÍ (nutno udělat)

1. **Skutečný Google Apps Script.** Kód běžel jen nad napodobeninou. Ověřit hlavně:
   - `fetch` POST `text/plain` na `…/exec` s přesměrováním na `googleusercontent.com` (CORS),
   - první spuštění menu v tabulce, autorizace, `setNumberFormat('@')`, `insertRowsAfter`,
   - zápis dat (`Date` ve sloupcích `vypujceno` / `vraceno`) a jejich čtení zpět,
   - časový spouštěč záloh a `DriveApp.makeCopy`.
2. **Kamera na reálných zařízeních** – iPhone (Safari, i aplikace přidaná na plochu),
   Android (Chrome), tablet. Rychlost a spolehlivost čtení malých štítků.
3. **Tisk na skutečné etikety** – formáty v `web/tisk.js` (`FORMATY_STITKU`) jsou odhad
   běžných archů A4; doladit podle etiket, které oddělení koupí. Ověřit Safari/Chrome
   (měřítko 100 %, okraje žádné) a čitelnost QR na štítku 52,5 × 29,7 mm.
4. **USB čtečka** – konkrétní model, rozložení klávesnice, zda posílá `Enter`.
5. **Instalace na plochu** (manifest, ikony) na iOS a Androidu.

## 6. Otevřená rozhodnutí

### 6.1 Hosting webu

Repozitář je **soukromý** (`miroslavkrupa/apps-evidence-vypujcek`). GitHub Pages ze soukromého
repozitáře vyžaduje placený GitHub Pro, což odporuje požadavku na nulové náklady.
Návod [docs/instalace.md](docs/instalace.md) zatím počítá s veřejným repozitářem a GitHub Pages.

| Varianta | Náklady | Poznámka |
|---|---|---|
| **Cloudflare Pages napojené na soukromý repozitář** (doporučeno) | 0 Kč | automatické nasazení po `git push`, adresa `*.pages.dev`; publikovat jen složku `web/` (build command žádný, output `web`) |
| Veřejný repozitář + GitHub Pages | 0 Kč | v repozitáři nejsou data ani PINy; nastavení už připravené (`.nojekyll`, kořenový `index.html` přesměruje na `web/`) |
| GitHub Pro + Pages | předplatné | nevyhovuje zadání |

Při volbě Cloudflare upravit `docs/instalace.md` (kapitola 6) a v `config.js` případně
nastavit `APP_URL`.

### 6.2 Vlastnictví účtů

Návrh počítá s **účtem oddělení** (Google i GitHub/Cloudflare), aby šla správa předat.
Repozitář je teď na osobním účtu zadavatele – před ostrým provozem zvážit převod
(GitHub: Settings → Transfer ownership).

### 6.3 Vizuální styl FN Ostrava

Aplikace má zatím vlastní neutrální styl (zelenomodrá `#0f766e`). Zadavatel chce
navázat na styl FNO. Oficiální brand manuál **není na fno.cz veřejně dostupný** – vyžádat
od oddělení komunikace FNO. Do té doby lze vycházet z toho, co používá web fno.cz:

| Prvek | Hodnota |
|---|---|
| Modrá loga | `#006FAD` |
| Červená loga | `#EE3524` |
| Hlavní tmavě modrá webu | `#003267` (tmavší `#003B79`) |
| Žlutá (zvýraznění) | `#F9E217` |
| Světle modré | `#94B8DE`, `#DDF1FF`, `#F0F6FB` |
| Tmavě červená (důležité) | `#A71917` |
| Zelená (telefon) | `#398509` |
| Písmo | Exo 2, nadpisy řez 500 |

Doporučení:

- barvy jsou definované jako proměnné na začátku `web/styles.css` (`:root` + tmavý režim) –
  stačí je přemapovat; zachovat kontrast (WCAG AA),
- písmo Exo 2 (licence SIL OFL) **zkopírovat do repozitáře** (`web/fonts/`, woff2), nenačítat
  z Google Fonts – zásada nezávislosti na cizích serverech,
- **logo FNO nepoužívat** bez souhlasu nemocnice; na štítcích a kartičkách zůstává textový
  název z `config.js` (`ODDELENI`). Barva pruhu kartičky je v `styles.css` (`.karticka .pruh`).

### 6.4 Otázky na zadavatele

Viz [NAVRH.md, kapitola 14](NAVRH.md): počet knih a pracovníků, existující seznam knih,
kdo bude správce, stálé zařízení u knihovny, typ etiket, kartička vs. štítek na průkaz,
limit dlouhých výpůjček (výchozí 90 dní).

## 7. Známá omezení a vědomé kompromisy

- **PIN v `localStorage`** v čitelné podobě – zařízení oddělení se považují za důvěryhodná;
  odhlášení PIN smaže. Změna PINu v tabulce odhlásí všechna zařízení.
- **Blokace po 10 chybných PINech je globální** (15 min). Kdo zná adresu API, může
  přihlašování dočasně zablokovat; zrušení: menu v tabulce *Zrušit blokaci PINů*.
  Pro malé interní použití přijatelné.
- **Aplikace načítá všechna data najednou** (`nacist`) – dimenzováno na jednotky tisíc knih.
- **Neevidujeme, kdo provedl vrácení** – jen čas. Pokud bude potřeba, doplnit sloupec.
- **Bez offline režimu a bez service workeru** – záměrně (žádné potíže se zastaralou mezipamětí).
- Nečinnost 90 s zruší rozpracovanou výpůjčku (`NECINNOST_MS` v `app.js`) – kvůli sdílenému tabletu.
- Zálohy kopírují celou tabulku včetně navázaného skriptu (kopie se nespouštějí).
- Napodobenina Google služeb v `dev/` je zjednodušená (formáty buněk ignoruje, zámky neřeší
  souběh) – testy nenahrazují ověření na skutečném Apps Scriptu.

Ve verzi 1 záměrně chybí: upomínky e-mailem, rezervace, offline, účty jednotlivých pracovníků.

## 8. Doporučený postup dokončení

1. Rozhodnout hosting (6.1) a vlastnictví účtů (6.2).
2. Nasadit Google část podle [docs/instalace.md](docs/instalace.md) (kapitoly 1–5) na testovací
   tabulku, doplnit `API_URL`, nasadit web.
3. Projít kontrolní seznam níže na iPhonu, Androidu a PC.
4. Zapracovat vizuální styl FNO (6.3).
5. Doladit formát štítků podle zakoupených etiket.
6. Vyplnit ostrá data (import knih), vytisknout štítky a kartičky, zaškolit správce
   ([docs/navod-spravce.md](docs/navod-spravce.md)) a vyvěsit [docs/navod-uzivatel.md](docs/navod-uzivatel.md).
7. Po změnách `Code.gs` vždy *Spravovat nasazení → Nová verze* (zachová adresu API).

## 9. Kontrolní seznam před ostrým provozem

- [ ] `GET …/exec` vrací `{"ok":true, …, "nastaveno":true}`
- [ ] přihlášení oběma PINy, chybný PIN, blokace a její zrušení z tabulky
- [ ] výpůjčka kamerou na iPhonu i Androidu (kniha → kartička i kartička → kniha)
- [ ] vrácení kamerou; pokus půjčit vypůjčenou knihu z druhého zařízení skončí srozumitelnou chybou
- [ ] QR štítek naskenovaný běžným fotoaparátem otevře aplikaci s knihou
- [ ] USB čtečka na PC s českou klávesnicí
- [ ] ruční výpůjčka a vrácení bez kamery
- [ ] přidání knihy a pracovníka, import 50+ knih z Excelu
- [ ] tisk štítků na skutečné etikety sedí; QR čitelné z 10–20 cm
- [ ] tisk kartiček, čitelnost po zalaminování
- [ ] data v tabulce čitelná, ruční oprava v tabulce se projeví po „Obnovit“
- [ ] měsíční záloha se vytvoří (ručně *Zálohovat teď*)
- [ ] aplikace přidaná na plochu iPhonu a Androidu se otevře a kamera funguje
