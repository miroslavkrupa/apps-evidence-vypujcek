# Instalace – krok za krokem

Celé nastavení zabere 1–2 hodiny a dělá se jen jednou. Není potřeba žádný server ani pomoc IT.
Budete potřebovat: Google účet a účet na GitHubu (oba zdarma).

## 1. Google účet oddělení

Založte samostatný Google účet pro knihovnu (např. `kozni.knihovna.fno@gmail.com`).
Nepoužívejte osobní účet – aplikace a data k účtu patří a musí se dát předat.

- nastavte obnovovací telefon a e-mail,
- přihlašovací údaje uložte tak, aby je znali **alespoň dva lidé** z oddělení.

## 2. Google tabulka a skript

1. Přihlaste se účtem oddělení do [Google Disku](https://drive.google.com) a vytvořte novou
   tabulku, např. **Evidence výpůjček – Kožní oddělení**.
2. V tabulce otevřete **Rozšíření → Apps Script**.
3. V editoru smažte ukázkový kód v souboru `Kód.gs` (`Code.gs`) a vložte celý obsah souboru
   [`apps-script/Code.gs`](../apps-script/Code.gs). Uložte (ikona diskety nebo Ctrl+S / Cmd+S).
4. Vlevo **Nastavení projektu** (ozubené kolo) → **Časové pásmo**: `(GMT+01:00) Praha`.
5. Vraťte se do tabulky a obnovte stránku (F5). Po chvíli se v nabídce objeví položka
   **Evidence výpůjček**.

## 3. Příprava tabulky a PINy

V tabulce v nabídce **Evidence výpůjček** postupně spusťte:

1. **Připravit listy** – při prvním spuštění Google požádá o oprávnění.
   Objeví se varování *„Google tuto aplikaci neověřil“* – je to v pořádku, jde o váš vlastní skript.
   Klikněte na **Rozšířené → Přejít na … (nebezpečné)** → **Povolit**.
   Vzniknou listy `Knihy`, `Pracovnici` a `Vypujcky`.
2. **Nastavit PIN pro pracovníky** – PIN, který budou zadávat všichni (aspoň 6 znaků).
3. **Nastavit PIN správce** – jiný PIN pro toho, kdo přidává knihy, pracovníky a tiskne štítky.
4. **Zapnout měsíční zálohy** – každý 1. den v měsíci se uloží kopie tabulky do složky
   *Zálohy – evidence výpůjček* na Google Disku (ponechá se posledních 24).

PINy se ukládají jen jako otisk (hash) ve vlastnostech skriptu, ne v tabulce.

## 4. Zveřejnění API

1. V editoru Apps Scriptu vpravo nahoře **Nasadit → Nové nasazení**.
2. U „Vyberte typ“ (ozubené kolo) zvolte **Webová aplikace**.
3. Nastavte:
   - Popis: `Evidence výpůjček`
   - Spustit jako: **Já** (účet oddělení)
   - Kdo má přístup: **Kdokoli**
4. **Nasadit** a zkopírujte **adresu URL webové aplikace** (končí na `/exec`).
5. Kontrola: otevřete tuto adresu v prohlížeči. Musí se zobrazit text
   `{"ok":true,"sluzba":"evidence-vypujcek","verze":1,"nastaveno":true}`.

„Kdokoli“ znamená, že se adresa dá zavolat bez přihlášení Googlem. Data jsou chráněná PINem,
bez něj API nic nevrátí.

## 5. Nastavení webové aplikace

V souboru [`web/config.js`](../web/config.js) vložte zkopírovanou adresu do `API_URL`:

```js
API_URL: 'https://script.google.com/macros/s/AKfy…/exec',
```

Případně upravte název oddělení (tiskne se na štítky) a limit dní pro zvýraznění dlouhých výpůjček.

## 6. Zveřejnění webu na GitHub Pages

1. Založte účet na [github.com](https://github.com) (ideálně také pod e-mailem oddělení).
2. **New repository** → název např. `apps-evidence-vypujcek` → **Public** → **Create repository**.
3. Na stránce repozitáře **uploading an existing file** (nebo *Add file → Upload files*)
   a přetáhněte **celý obsah** složky projektu (soubory `index.html`, `README.md` a složky
   `web`, `apps-script`, `docs`, `dev`). Soubory `dev/data.json` a `dev/props.json`, pokud
   existují, nenahrávejte – jsou jen pro lokální zkoušení. Potvrďte **Commit changes**.
4. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, složka `/ (root)` → **Save**.
5. Do pár minut bude aplikace na adrese
   `https://<uživatel>.github.io/apps-evidence-vypujcek/web/`
   (adresa `…/apps-evidence-vypujcek/` na ni automaticky přesměruje).

Repozitář je veřejný, ale **neobsahuje žádná data ani PINy** – jen kód aplikace.
Data jsou výhradně v Google tabulce.

> Alternativa: místo GitHub Pages lze složku `web/` nahrát na
> [Cloudflare Pages](https://pages.cloudflare.com) (také zdarma, „Upload assets“).

## 7. První spuštění

1. Otevřete adresu aplikace, přihlaste se **PINem správce**.
2. **Správa → Hromadný import** – vložte seznam knih zkopírovaný z Excelu,
   nebo je přidávejte po jedné (**+ Nová kniha**).
3. **Správa → + Nový pracovník** pro každého, kdo si bude půjčovat.
4. **Správa → Štítky knih** – vytiskněte štítky na samolepicí etikety a nalepte je na knihy
   (např. na zadní stranu obálky).
5. **Správa → Kartičky pracovníků** – vytiskněte, vystřihněte, ideálně zalaminujte.
6. Zkuste jednu výpůjčku a vrácení.

Při tisku zvolte v dialogu prohlížeče **měřítko 100 %** (ne „Přizpůsobit stránce“) a **okraje: žádné**.
Pokud štítky nesedí na etikety, dolaďte **Posun vpravo/dolů** v dialogu tisku – nastavení si
aplikace zapamatuje.

## 8. Zařízení na oddělení

- **Telefon nebo tablet**: otevřete adresu aplikace a přidejte ji na plochu
  (iPhone/iPad: Safari → Sdílet → *Přidat na plochu*; Android: Chrome → ⋮ → *Přidat na plochu*).
  Při prvním skenování povolte přístup ke kameře.
- **Počítač s USB čtečkou QR kódů** (volitelné, cca 500–1 000 Kč): čtečka se chová jako klávesnice,
  stačí mít aplikaci otevřenou na záložce *Skenovat*. Funguje i s českou klávesnicí.

## Úpravy kódu později

- **Webová část**: nahrajte změněné soubory do repozitáře na GitHubu, za pár minut se projeví.
- **Apps Script**: po změně kódu nestačí uložit. Je potřeba
  **Nasadit → Spravovat nasazení → ✏️ (upravit) → Verze: Nová verze → Nasadit**.
  Tím zůstane stejná adresa API. (*Nové nasazení* by vytvořilo novou adresu a bylo by nutné
  změnit `config.js`.)

## Řešení potíží

| Problém | Řešení |
|---|---|
| Aplikace hlásí „chybí adresa API“ | Doplňte `API_URL` v `web/config.js` a nahrajte soubor na GitHub. |
| „Server nevrátil platnou odpověď“ | Adresa API je špatně, nebo nasazení nemá přístup „Kdokoli“. Otevřete adresu API v prohlížeči – musí vrátit text s `"ok":true`. |
| „Aplikace ještě není nastavená“ | V tabulce nastavte oba PINy (menu Evidence výpůjček). |
| „Příliš mnoho chybných PINů“ | Počkejte 15 minut, nebo v tabulce *Evidence výpůjček → Zrušit blokaci PINů*. |
| Nejde kamera | Aplikace musí běžet přes `https://`. Povolte kameru v nastavení prohlížeče pro tuto stránku. Vždy lze použít *Zadat ručně*. |
| Zapomenutý PIN | V tabulce nastavte nový (menu Evidence výpůjček). Zařízení se pak přihlásí znovu. |
