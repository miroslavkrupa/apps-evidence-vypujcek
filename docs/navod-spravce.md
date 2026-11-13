# Návod pro správce

Správce se do aplikace přihlašuje **PINem správce** – pak vidí záložku **Správa**.

## Knihy

- **+ Nová kniha** – vyplňte aspoň název. ID (např. `K0042`) se přidělí automaticky.
  Hned potom lze vytisknout štítek.
- **Hromadný import** – v Excelu označte řádky se sloupci *Název, Autor, Vydání, ISBN, Umístění*
  (stačí jen Název), zkopírujte a vložte. Řádek s hlavičkou se přeskočí.
- **Úprava / vyřazení** – záložka Knihy → klepněte na knihu → **Upravit**.
  Vyřazenou knihu (ztracená, zničená) nemažte, jen zrušte zaškrtnutí „Kniha je v evidenci“.
  Historie výpůjček zůstane zachovaná.

## Pracovníci

- **+ Nový pracovník** – jméno a případně funkce. Hned potom lze vytisknout kartičku.
- Pracovníka, který odešel, **deaktivujte** (Lidé → jméno → Upravit). Nemažte ho.
- Ztracená kartička: vytiskněte novou (Lidé → jméno → Vytisknout kartičku). Kód je stejný.

## Tisk

- **Štítky knih** – vyberte knihy, formát etiket a tiskněte. Na načatém archu nastavte
  „Přeskočit štítků“. Pokud tisk nesedí, dolaďte posun v mm.
- **Kartičky pracovníků** – 10 na A4, velikost platební karty.
- V dialogu tisku prohlížeče vždy: **měřítko 100 %**, **okraje žádné**.

## Data v Google tabulce

Všechna data jsou v Google tabulce oddělení (listy `Knihy`, `Pracovnici`, `Vypujcky`).
Tabulku lze bezpečně prohlížet, filtrovat a exportovat (Soubor → Stáhnout → Excel).

Ruční úpravy v tabulce:

- ✅ opravit překlep v názvu, autorovi, jménu, poznámce,
- ✅ přidat si vlastní sloupec (aplikace ho ignoruje),
- ✅ doplnit datum vrácení, když někdo zapomněl knihu vrátit v aplikaci,
- ⚠️ neměňte sloupec `id` a názvy sloupců v prvním řádku,
- ⚠️ nemažte řádky – místo toho knihu nebo pracovníka deaktivujte (`aktivni` = `NE`).

## PINy

PINy se mění v tabulce: **Evidence výpůjček → Nastavit PIN pro pracovníky / správce**.
Po změně se všechna zařízení musí přihlásit znovu. PIN měňte např. když odejde někdo,
kdo ho znal, a jinak zhruba jednou ročně.

## Zálohy

- Google tabulka si sama pamatuje historii verzí (Soubor → Historie verzí).
- Každý měsíc se automaticky ukládá kopie do složky *Zálohy – evidence výpůjček* na Google Disku.
- Okamžitou zálohu vytvoříte v tabulce: **Evidence výpůjček → Zálohovat teď**.

## Předání správy

Novému správci předejte:

1. přístup ke Google účtu oddělení (heslo, obnovovací údaje),
2. přístup k účtu na GitHubu (kde běží web),
3. PIN správce,
4. tento návod a soubor `docs/instalace.md`.
