// Čtení QR kódů: kamera v prohlížeči a USB/Bluetooth čtečka (chová se jako klávesnice).

/** Délka čísla v ID podle typu (K0042, P012). */
const DELKA = { K: 4, P: 3 };

// USB čtečka posílá kódy kláves podle americké klávesnice. Při české klávesnici
// se z číslic stanou znaky +ěščřžýáíé – převedeme je zpět.
const CZ_CISLICE = { '+': '1', 'ě': '2', 'š': '3', 'č': '4', 'ř': '5', 'ž': '6', 'ý': '7', 'á': '8', 'í': '9', 'é': '0' };

/**
 * Z obsahu QR kódu (adresa aplikace s #k=K0042, nebo jen K0042) vytáhne typ a ID.
 * @returns {{typ: 'kniha'|'pracovnik', id: string} | null}
 */
export function rozpoznejKod(text) {
  const t = String(text || '').trim().replace(/[+ěščřžýáíé]/g, (z) => CZ_CISLICE[z]);
  const m = /([KkPp])(\d{1,7})\s*$/.exec(t);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const id = prefix + m[2].padStart(DELKA[prefix], '0');
  return { typ: prefix === 'K' ? 'kniha' : 'pracovnik', id };
}

export class Kamera {
  /**
   * @param {HTMLVideoElement} video
   * @param {(text: string) => void} priKodu
   */
  constructor(video, priKodu) {
    this.video = video;
    this.priKodu = priKodu;
    this.stream = null;
    this.bezi = false;
    this.pozastaveno = false;
    this.posledni = { text: '', cas: 0 };
    this.platno = document.createElement('canvas');
    this.ctx = this.platno.getContext('2d', { willReadFrequently: true });
    this.detektor = null;
  }

  static jeDostupna() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async spust() {
    if (this.bezi) return;
    if (!Kamera.jeDostupna()) throw new Error('Tento prohlížeč neumožňuje použít kameru (je potřeba zabezpečené připojení https).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.bezi = true;
    await this.pripravDetektor();
    this.smycka();
  }

  async pripravDetektor() {
    if (this.detektor !== null || !('BarcodeDetector' in window)) return;
    try {
      const formaty = await window.BarcodeDetector.getSupportedFormats();
      if (formaty.includes('qr_code')) this.detektor = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      this.detektor = null;
    }
  }

  zastav() {
    this.bezi = false;
    clearTimeout(this.casovac);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  smycka() {
    if (!this.bezi) return;
    this.casovac = setTimeout(async () => {
      try {
        if (!this.pozastaveno && this.video.readyState >= 2) {
          const text = await this.precti();
          if (text) this.nalezeno(text);
        }
      } catch { /* jednotlivý snímek se nepovedl – nevadí */ }
      this.smycka();
    }, 120);
  }

  async precti() {
    if (this.detektor) {
      const kody = await this.detektor.detect(this.video);
      return kody.length ? kody[0].rawValue : null;
    }
    if (typeof window.jsQR !== 'function') return null;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    const meritko = Math.min(1, 720 / Math.max(vw, vh));
    const w = Math.round(vw * meritko);
    const h = Math.round(vh * meritko);
    if (this.platno.width !== w) this.platno.width = w;
    if (this.platno.height !== h) this.platno.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);
    const obraz = this.ctx.getImageData(0, 0, w, h);
    const kod = window.jsQR(obraz.data, w, h, { inversionAttempts: 'dontInvert' });
    return kod ? kod.data : null;
  }

  nalezeno(text) {
    const ted = Date.now();
    // stejný kód držený před kamerou nezpracovávat opakovaně
    if (text === this.posledni.text && ted - this.posledni.cas < 3000) {
      this.posledni.cas = ted;
      return;
    }
    this.posledni = { text, cas: ted };
    this.priKodu(text);
  }

  /** Zapomene poslední kód, aby šel stejný kód hned naskenovat znovu. */
  zapomen() {
    this.posledni = { text: '', cas: 0 };
  }
}

/**
 * USB/Bluetooth čtečka: znaky přicházejí velmi rychle za sebou a končí Enterem.
 * Ruční psaní (pomalejší) se ignoruje. Nereaguje, když je kurzor v textovém poli.
 */
export function poslouchejCtecku(priKodu) {
  let buffer = '';
  let posledni = 0;
  document.addEventListener('keydown', (e) => {
    const cil = e.target;
    if (cil && (cil.tagName === 'INPUT' || cil.tagName === 'TEXTAREA' || cil.tagName === 'SELECT' || cil.isContentEditable)) return;
    const ted = performance.now();
    if (ted - posledni > 100) buffer = '';
    posledni = ted;
    if (e.key === 'Enter') {
      if (buffer.length >= 3) {
        e.preventDefault();
        priKodu(buffer);
      }
      buffer = '';
      return;
    }
    if (e.key.length === 1) buffer += e.key;
  });
}
