# Evidence výpůjček – Kožní oddělení FN Ostrava

Technický návrh, verze 1 (13. 11. 2026)

## 1. Cíl

Jednoduchá webová aplikace pro evidenci výpůjček knih z knihovny oddělení:

- výpůjčka = naskenovat QR kód knihy + QR kód pracovníka,
- vrácení = naskenovat QR kód knihy,
- vše lze provést i ručně (vyhledáním),
- žádné náklady, žádný server, žádná součinnost IT FNO, minimální údržba po řadu let.

## 2. Architektura

```
 Telefon / tablet / PC – libovolný moderní prohlížeč
            │
            ▼
 ┌──────────────────────────────────────────────┐
 │ Webová aplikace (statické soubory)            │
 │ HTML + CSS + čistý JavaScript, bez frameworku │
 │ hosting: GitHub Pages (zdarma)                │
 └──────────────────────────────────────────────┘
            │  HTTPS, JSON, každý požadavek nese PIN
            ▼
 ┌──────────────────────────────────────────────┐
 │ API v Google Apps Scriptu (doGet / doPost)    │
 │ ověří PIN, zamkne zápis (LockService),        │
 │ čte a zapisuje tabulku                        │
 └──────────────────────────────────────────────┘
            │
            ▼
 ┌──────────────────────────────────────────────┐
 │ Google tabulka: Knihy | Pracovníci | Výpůjčky │
 │ + automatická měsíční záloha na Google Disk   │
 └──────────────────────────────────────────────┘
```

Vše běží pod jedním Google účtem oddělení (např. `kozni.knihovna.fno@gmail.com`),
ke kterému mají přístup alespoň dva lidé.

### Zásady pro dlouhou životnost

| Zásada | Proč |
|---|---|
| Žádný build, žádné npm, žádný framework | Za 5 let nebude co aktualizovat ani co se rozbije při instalaci závislostí. |
| Knihovny třetích stran zkopírované v repozitáři (ne z CDN) | Nezávislost na dostupnosti CDN a změnách verzí. |
| Pouze standardní webová rozhraní (fetch, getUserMedia, print CSS) | Prohlížeče je udržují zpětně kompatibilní. |
| Data v běžné tabulce | Čitelná a opravitelná bez aplikace, přežijí i případný konec aplikace. |
| Bez service workeru | Odpadají problémy se zastaralou verzí v mezipaměti. |

## 3. Datový model (Google tabulka)

### List `Knihy`

| Sloupec | Příklad | Poznámka |
|---|---|---|
| `id` | `K0042` | generuje aplikace, neměnné, je v QR kódu |
| `nazev` | Dermatologie | povinné |
| `autor` | Štork J. a kol. | |
| `vydani` | 3. vyd., 2019 | volný text |
| `isbn` | 978-80-... | volitelné |
| `umisteni` | Knihovna, police 2 | volitelné |
| `poznamka` | | |
| `aktivni` | `ANO` / `NE` | vyřazené knihy se nemažou, jen deaktivují |
| `vytvoreno` | 2026-11-20 | |

### List `Pracovnici`

| Sloupec | Příklad | Poznámka |
|---|---|---|
| `id` | `P012` | generuje aplikace, je v QR kódu kartičky |
| `jmeno` | Jana Nováková | povinné |
| `funkce` | lékař / sestra / … | volitelné |
| `poznamka` | | |
| `aktivni` | `ANO` / `NE` | odchod z oddělení = deaktivace, historie zůstane |
| `vytvoreno` | | |

Ukládá se jen jméno a případně funkce. Žádné e-maily, telefony ani rodná čísla.

### List `Vypujcky`

| Sloupec | Příklad | Poznámka |
|---|---|---|
| `id` | `V000318` | |
| `kniha_id` | `K0042` | |
| `pracovnik_id` | `P012` | |
| `vypujceno` | 2026-11-20 09:14 | |
| `vraceno` | prázdné / 2026-12-02 13:40 | prázdné = kniha je venku |
| `zpusob` | `sken` / `rucne` | pro přehled, jak se aplikace používá |
| `poznamka` | | |

Pro čitelnost obsahuje list navíc sloupce `nazev_knihy` a `jmeno_pracovnika`. Aplikace do nich
při výpůjčce zapíše název a jméno (jako hodnotu, ne vzorec), aby byl list srozumitelný i bez
aplikace a historie zůstala čitelná i po pozdější úpravě názvu.

Aplikace hledá sloupce podle názvu v prvním řádku, takže pořadí sloupců lze měnit a přidávat
vlastní sloupce. Chybějící sloupce si doplní sama.

## 4. Obsah QR kódů

QR kód obsahuje **adresu aplikace s ID**, např.:

- kniha: `https://<adresa-aplikace>/#k=K0042`
- pracovník: `https://<adresa-aplikace>/#p=P012`

Výhody:

- naskenuje-li knihu kdokoli běžným fotoaparátem telefonu, otevře se rovnou aplikace s touto knihou,
- skener v aplikaci z kódu vždy vytáhne jen ID (`K…` / `P…`), takže štítky **fungují v aplikaci
  i po případné změně adresy** – jen otevření běžným fotoaparátem by pak vedlo na starou adresu.

## 5. Funkce a obrazovky

### 5.1 Skenování (hlavní obrazovka)

Kamera je zapnutá, stačí přikládat kódy. **Pořadí kniha/pracovník je libovolné.**

```
naskenována KNIHA
 ├─ kniha je volná      → „Kniha: Dermatologie. Naskenujte kartičku pracovníka."
 │                          → naskenován PRACOVNÍK → zapsat výpůjčku → ✅ potvrzení
 └─ kniha je vypůjčená  → „Vypůjčeno: J. Nováková od 20. 11."
                            [Vrátit]  (velké tlačítko, jedno klepnutí)

naskenován PRACOVNÍK
 → „Pracovník: J. Nováková (má 2 knihy). Naskenujte knihu."
 → naskenována KNIHA → zapsat výpůjčku → ✅
```

- Po dokončení tlačítko **„Další kniha pro stejného pracovníka"**.
- Kdykoli lze rozpracovaný krok zrušit.
- Pod kamerou vždy tlačítko **„Zadat ručně"**.
- Zvuková a vizuální odezva (zelená = hotovo, červená = chyba).

### 5.2 Ruční zadání

- Vyhledání knihy podle názvu / autora / ID (filtruje se okamžitě v načtených datech),
- vyhledání pracovníka podle jména,
- tlačítka Vypůjčit / Vrátit.

### 5.3 Přehled vypůjčených

- seznam knih, které jsou venku: kniha, komu, od kdy, počet dní,
- řazení a hledání,
- zvýraznění výpůjček delších než nastavený limit (výchozí 90 dní),
- u každé položky tlačítko Vrátit.

### 5.4 Katalog a historie

- všechny knihy se stavem (volná / u koho),
- detail knihy: historie výpůjček,
- detail pracovníka: co má půjčeno, historie.

### 5.5 Správa (pouze se správcovským PINem)

- přidání / úprava / deaktivace knih a pracovníků,
- hromadný import knih vložením ze schránky (zkopírované řádky z Excelu),
- **tisk štítků knih** – arch A4 samolepicích etiket (např. 3 × 8 ks, 70 × 37 mm):
  QR kód + ID + zkrácený název + „Kožní odd. FNO",
- **tisk kartiček pracovníků** – formát platební karty (85 × 54 mm), 10 ks na A4:
  QR kód + jméno; k zalaminování nebo nalepení na zadní stranu služebního průkazu,
- výběr, co tisknout (vše / nové / vybrané).

## 6. Načítání QR kódů

1. **Kamera v prohlížeči** – nativní `BarcodeDetector` tam, kde je k dispozici (Chrome na Androidu),
   jinak knihovna **jsQR** (čistý JavaScript, licence Apache 2.0, zkopírovaná do repozitáře).
   Funguje na Androidu i iPhonu.
2. **USB / Bluetooth čtečka** (volitelně, cca 500–1 000 Kč) – chová se jako klávesnice;
   aplikace rozpozná rychlý vstup zakončený Enterem a zpracuje ho stejně jako sken kamerou.
   Vhodné pro stálé místo u knihovny s PC.

Generování QR kódů pro tisk: knihovna **qrcode-generator** (Kazuhiko Arase, licence MIT),
také zkopírovaná v repozitáři.

## 7. API (Apps Script)

Jedna adresa nasazené webové aplikace Apps Scriptu („Spustit jako: já", „Přístup: kdokoli").
Požadavky `POST` s tělem `text/plain` obsahujícím JSON (tím se obejde CORS preflight,
který Apps Script nepodporuje).

```json
{ "akce": "vypujcit", "pin": "••••", "data": { "kniha": "K0042", "pracovnik": "P012", "zpusob": "sken" } }
```

| Akce | Role | Popis |
|---|---|---|
| `prihlasit` | – | ověří PIN, vrátí roli (`uzivatel` / `spravce`) |
| `nacist` | uživatel | vrátí knihy, pracovníky a otevřené výpůjčky (celá data najednou – i 3 000 knih je pár set kB) |
| `vypujcit` | uživatel | kontrola, že kniha není venku, zápis řádku |
| `vratit` | uživatel | doplní `vraceno` u otevřené výpůjčky knihy |
| `historie` | uživatel | výpůjčky knihy / pracovníka / období |
| `ulozitKnihu`, `ulozitPracovnika` | správce | přidání nebo úprava |
| `importKnih` | správce | hromadné přidání |

- Každý zápis běží pod `LockService` – dva současné skeny nevytvoří duplicitu.
- Aplikace po startu načte celá data jednou; hledání a zobrazení je pak okamžité.
  Síťová prodleva (cca 1–2 s) je jen při zápisu, mezitím se zobrazí „Ukládám…".
- Po zápisu API vrací aktuální stav dotčené knihy, takže se data průběžně obnovují.

## 8. Zabezpečení

- **Dva PINy**: uživatelský (výpůjčky, vrácení, přehledy) a správcovský (správa, tisk).
  Uložené jako hash ve Vlastnostech skriptu, ne v kódu ani v tabulce.
- PIN se zadá jednou na zařízení a uloží se v prohlížeči; lze se odhlásit.
- Ochrana proti hádání: po 10 chybných pokusech z libovolného zdroje se přihlašování na 15 min zablokuje.
- Webová aplikace sama žádná data neobsahuje – bez PINu z ní nic nezjistíte.
- Tabulka je sdílená jen s účtem oddělení a se jmenovanými správci.
- Rozsah osobních údajů je minimální (jméno, případně funkce).

## 9. Zálohy

- Historie verzí Google tabulky (automaticky, Google).
- Časový spouštěč v Apps Scriptu: 1. den v měsíci vytvoří kopii tabulky do složky
  `Zálohy` na Google Disku a ponechá posledních 24 kopií.

## 10. Struktura repozitáře

```
apps-evidence-vypujcek/
├── NAVRH.md                  tento dokument
├── README.md                 co to je, odkazy
├── index.html                přesměrování na web/ (GitHub Pages publikuje celý repozitář)
├── web/                      webová aplikace
│   ├── index.html
│   ├── app.js                logika obrazovek a skenování
│   ├── api.js                komunikace s Apps Scriptem
│   ├── skener.js             kamera a USB čtečka
│   ├── tisk.js               štítky a kartičky
│   ├── util.js               pomocné funkce
│   ├── styles.css            včetně tiskových stylů
│   ├── config.js             adresa API (jediné místo ke změně)
│   ├── manifest.webmanifest  instalace na plochu telefonu
│   ├── icons/
│   ├── demo/                 ukázkový režim: Code.gs v prohlížeči nad testovacími daty
│   │   ├── ukazka.js
│   │   └── gas.js            napodobenina služeb Google (sdílí ji i dev/)
│   └── vendor/
│       ├── jsQR.js
│       └── qrcode.js
├── apps-script/
│   ├── Code.gs               API, zámky, zálohy
│   └── appsscript.json
├── dev/                      jen pro vývoj (provoz to nepotřebuje)
│   ├── server.mjs            lokální server: web/ + Code.gs nad napodobeninou tabulky
│   ├── gas-shim.mjs          spuštění Code.gs v Node.js nad web/demo/gas.js
│   ├── test-api.mjs          automatické testy API
│   └── ikony.mjs             generátor ikon
└── docs/
    ├── instalace.md          krok za krokem: účet, tabulka, Apps Script, GitHub Pages
    ├── navod-uzivatel.md     jedna stránka pro pracovníky (k vytištění)
    └── navod-spravce.md      přidávání knih, tisk, PINy, předání správy
```

## 11. Postup nasazení (shrnutí, detail v `docs/instalace.md`)

1. Založit Google účet oddělení.
2. Vytvořit tabulku ze šablony (aplikace si listy a hlavičky založí sama při prvním spuštění).
3. Vložit `Code.gs` do Apps Scriptu tabulky, nastavit PINy, nasadit jako webovou aplikaci.
4. Adresu API vložit do `web/config.js`.
5. Publikovat složku `web/` na GitHub Pages (účet na GitHubu zdarma).
6. Naimportovat knihy a pracovníky, vytisknout štítky a kartičky.

Odhad: 1–2 hodiny jednorázově.

## 12. Rizika a jak je tlumit

| Riziko | Dopad | Opatření |
|---|---|---|
| Ztráta přístupu ke Google účtu | aplikace i data nedostupné | 2+ lidé znají přístup, obnovovací telefon/e-mail, měsíční zálohy |
| Google změní Apps Script | API přestane fungovat | data zůstanou v tabulce; API je jeden malý soubor, oprava je snadná |
| GitHub Pages skončí / změní podmínky | web nedostupný | statické soubory lze přesunout kamkoli (Cloudflare Pages, Netlify) za pár minut |
| Prohlížeč zakáže kameru | nelze skenovat | ruční zadání a USB čtečka fungují vždy |
| Výpadek internetu | aplikace nefunguje | dočasně zapisovat na papír, doplnit ručně |

## 13. Co ve verzi 1 záměrně není

- upomínky e-mailem (vyžadovalo by ukládat e-maily),
- rezervace knih,
- offline režim,
- samostatné účty pro každého pracovníka.

Vše lze doplnit později, pokud bude potřeba.

## 14. Otevřené otázky

1. Přibližný počet knih a pracovníků? Existuje už seznam knih (Excel)?
2. Kdo bude správce (přidávání knih, tisk)? Postačí dva PINy, nebo je potřeba víc?
3. Bude u knihovny stálé zařízení (tablet / PC), nebo se bude skenovat osobními telefony?
4. Jaké samolepicí etikety jsou k dispozici (rozměr / počet na arch)?
5. Má být kartička samostatná, nebo štítek na služební průkaz?
6. Limit pro zvýraznění dlouhých výpůjček – 90 dní vyhovuje?
