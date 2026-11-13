// Drobné pomocné funkce pro práci s DOM, daty a zpětnou vazbou.

/** Vytvoří element: el('div', {class: 'x', onclick: fn}, 'text', jinyElement, [pole]) */
export function el(tag, atributy = {}, ...deti) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atributy || {})) {
    if (v === undefined || v === null || v === false || k === 'value') continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  pridej(e, deti);
  if (atributy && atributy.value !== undefined && atributy.value !== null) e.value = atributy.value;
  return e;
}

function pridej(e, deti) {
  for (const d of deti) {
    if (d === undefined || d === null || d === false) continue;
    if (Array.isArray(d)) pridej(e, d);
    else e.append(d instanceof Node ? d : document.createTextNode(String(d)));
  }
}

export const $ = (sel, koren = document) => koren.querySelector(sel);

const fmtDatum = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtDatumCas = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function datum(iso) {
  return iso ? fmtDatum.format(new Date(iso)) : '';
}

export function datumCas(iso) {
  return iso ? fmtDatumCas.format(new Date(iso)) : '';
}

/** Počet celých dní od data (podle kalendářních dnů). */
export function dniOd(iso) {
  const d = new Date(iso);
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const t = new Date();
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.max(0, Math.round((b - a) / 864e5));
}

export function dnyText(n) {
  if (n === 0) return 'dnes';
  if (n === 1) return '1 den';
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dní`;
}

export function knihText(n) {
  if (n === 1) return '1 kniha';
  if (n >= 2 && n <= 4) return `${n} knihy`;
  return `${n} knih`;
}

/** Text pro hledání: malá písmena bez diakritiky. */
export function proHledani(...casti) {
  return casti.filter(Boolean).join(' ').toLocaleLowerCase('cs').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function odpovida(text, dotaz) {
  const slova = proHledani(dotaz).split(/\s+/).filter(Boolean);
  return slova.every((s) => text.includes(s));
}

export function toast(zprava, typ = '', trvani = 3500) {
  const t = el('div', { class: `toast ${typ}`, role: typ === 'chyba' ? 'alert' : 'status' }, zprava);
  const kontejner = document.getElementById('toasty');
  // otevřený modální dialog leží nad vším ostatním – hlášky musí být uvnitř něj
  const cil = document.querySelector('dialog[open]') || document.body;
  if (kontejner.parentElement !== cil) cil.append(kontejner);
  kontejner.append(t);
  setTimeout(() => t.remove(), trvani);
}

let audio;
/** Krátké pípnutí a zavibrování jako potvrzení skenu. */
export function pipnout(uspech = true) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = uspech ? 1046 : 220;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (uspech ? 0.15 : 0.4));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.45);
  } catch { /* zvuk není podstatný */ }
  try { navigator.vibrate?.(uspech ? 60 : [80, 60, 80]); } catch { /* nic */ }
}

/** Odemkne zvuk po prvním dotyku (vyžadují to mobilní prohlížeče). */
export function odemkniZvuk() {
  const fn = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume?.();
    } catch { /* nic */ }
  };
  document.addEventListener('pointerdown', fn, { once: true });
  document.addEventListener('keydown', fn, { once: true });
}

export const uloziste = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* soukromý režim */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nic */ } },
};
