# Evidence výpůjček – Kožní oddělení FN Ostrava

Jednoduchá webová aplikace pro evidenci výpůjček knih z knihovny oddělení.
Výpůjčka = naskenovat QR kód knihy a kartičku pracovníka. Vrácení = naskenovat knihu.

- **Bez nákladů a bez serveru**: statický web (GitHub Pages nebo Cloudflare Pages), data v Google tabulce,
  zápis do ní zajišťuje malý skript v Google Apps Scriptu.
- **Bez závislostí**: čisté HTML/CSS/JavaScript, žádný build, žádné npm. Knihovny pro QR kódy a písmo
  jsou zkopírované v projektu (`web/vendor/`, `web/fonts/`).
- **Vzhled** v barvách a písmu FN Ostrava (předběžně podle webu fno.cz, viz PREDANI.md 6.3).

## Dokumentace

| Dokument | Pro koho |
|---|---|
| [PREDANI.md](PREDANI.md) | vývojář, který aplikaci dokončí: stav, neověřené části, otevřená rozhodnutí |
| [docs/instalace.md](docs/instalace.md) | první nasazení krok za krokem |
| [docs/navod-uzivatel.md](docs/navod-uzivatel.md) | pracovníci (jedna strana k vytištění) |
| [docs/navod-spravce.md](docs/navod-spravce.md) | správce knihovny |
| [NAVRH.md](NAVRH.md) | technický návrh a zdůvodnění rozhodnutí |

## Struktura

```
web/            webová aplikace (publikuje se)
  config.js       jediný soubor k úpravě při nasazení (adresa API)
  app.js          obrazovky a průběh výpůjčky/vrácení
  api.js          volání API
  skener.js       kamera a USB čtečka
  tisk.js         štítky a kartičky s QR kódy
  demo/           ukázkový režim (Code.gs v prohlížeči nad testovacími daty)
  vendor/         jsQR (čtení QR), qrcode-generator (tvorba QR)
apps-script/    API nad Google tabulkou (Code.gs) – vkládá se do Apps Scriptu
dev/            lokální vývoj a testy (nepotřebné pro provoz)
docs/           návody
index.html      přesměrování na web/ (pro GitHub Pages)
```

## Nasazení

Web běží na GitHub Pages: <https://miroslavkrupa.github.io/apps-evidence-vypujcek/>
(z větve `main`, každý push ho aktualizuje). Zatím bez Google části – v `web/config.js` chybí
adresa API (viz [PREDANI.md](PREDANI.md), 6.1). Repozitář je pro Pages připravený (kořenový
`index.html` přesměruje na `web/`, `.nojekyll` vypíná Jekyll); pro Cloudflare Pages stačí jako
výstupní složku zadat `web`. Postup pro Google část je v [docs/instalace.md](docs/instalace.md).

**Ukázka na testovacích datech:** <https://miroslavkrupa.github.io/apps-evidence-vypujcek/?ukazka>
(PIN pracovníci `111111`, správce `999999`; data zůstávají jen v daném prohlížeči,
viz [PREDANI.md](PREDANI.md), 6.5).

## Lokální vývoj

Potřebujete jen [Node.js](https://nodejs.org) (verze 18+), nic se neinstaluje.

```bash
node dev/server.mjs
```

Aplikace poběží na <http://localhost:8080/> s ukázkovými daty
(PIN pracovníci `111111`, správce `999999`). Server spouští skutečný `apps-script/Code.gs`
nad napodobeninou Google tabulky uloženou v `dev/data.json` (smazáním souboru se data obnoví).

```bash
node dev/test-api.mjs
```

spustí automatické testy API.

Kamera vyžaduje `https://` nebo `localhost`. Pro test na telefonu v lokální síti je nejjednodušší
nasadit na GitHub Pages.
