// Nastavení aplikace – jediný soubor, který se při nasazení upravuje.
window.APP_CONFIG = {
  // Adresa webové aplikace Google Apps Scriptu (končí na /exec).
  // Získáte ji v Apps Scriptu: Nasadit → Spravovat nasazení → Webová aplikace → Adresa URL.
  API_URL: '',

  // Název v záhlaví aplikace.
  NAZEV: 'Knihovna – Kožní oddělení',

  // Text tištěný na štítcích knih a kartičkách pracovníků.
  ODDELENI: 'Kožní oddělení FN Ostrava',

  // Po kolika dnech se výpůjčka zvýrazní jako dlouhá.
  LIMIT_DNI: 90,

  // Adresa aplikace, která se vkládá do QR kódů. Prázdné = aktuální adresa stránky.
  APP_URL: '',
};
