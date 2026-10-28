// Wechselkurse automatisch holen (EZB-Referenzkurse über Frankfurter, ohne API-Schlüssel).
// Aktualisiert nur Währungen, die in den Einstellungen vorkommen und nicht «fixiert» sind.
// Währungen, die die EZB nicht führt, bleiben unverändert (manuell pflegen).
//
// Klappt der Abruf auf dem Server nicht (z.B. Firmen-Proxy oder Firmenzertifikat), holt der Browser
// die Kurse selbst und schickt sie an /api/rates/apply.

export const RATE_URLS = [
  'https://api.frankfurter.dev/v1/latest?from=CHF',
  'https://api.frankfurter.app/latest?from=CHF', // alte Adresse (leitet weiter)
];

const HINTS = {
  ENOTFOUND: 'Adresse nicht gefunden – keine Internetverbindung oder DNS gesperrt',
  EAI_AGAIN: 'Adresse nicht gefunden – keine Internetverbindung oder DNS gesperrt',
  ECONNREFUSED: 'Verbindung abgelehnt – evtl. ist ein Proxy nötig',
  ECONNRESET: 'Verbindung abgebrochen – evtl. blockiert eine Firewall oder ein Proxy',
  ETIMEDOUT: 'Zeitüberschreitung – evtl. ist ein Proxy nötig',
  UND_ERR_CONNECT_TIMEOUT: 'Zeitüberschreitung – evtl. ist ein Proxy nötig',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Zertifikat nicht vertrauenswürdig – typisch für Firmennetze (start.bat verwendet die Windows-Zertifikate, wenn Node.js das unterstützt)',
  SELF_SIGNED_CERT_IN_CHAIN: 'Zertifikat nicht vertrauenswürdig – typisch für Firmennetze (start.bat verwendet die Windows-Zertifikate, wenn Node.js das unterstützt)',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Zertifikat nicht vertrauenswürdig – typisch für Firmennetze',
  CERT_HAS_EXPIRED: 'Zertifikat abgelaufen',
};

/** Verständliche Ursache aus einem fetch-Fehler */
export function describeFetchError(e) {
  if (e?.name === 'AbortError') return 'Zeitüberschreitung';
  const code = e?.cause?.code || e?.code || '';
  if (HINTS[code]) return `${HINTS[code]} (${code})`;
  return [e?.message, code].filter(Boolean).join(' – ') || 'unbekannter Fehler';
}

async function fetchOne(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Kursdienst antwortet mit ' + res.status);
    const j = await res.json();
    if (!j || typeof j.rates !== 'object') throw new Error('Unerwartete Antwort vom Kursdienst');
    return toChfPerUnit(j.date, j.rates);
  } finally {
    clearTimeout(t);
  }
}

/** Antwort des Dienstes (Einheiten pro 1 CHF) → CHF pro Einheit */
export function toChfPerUnit(date, unitsPerChf) {
  const rates = {};
  for (const [cur, v] of Object.entries(unitsPerChf || {})) {
    const x = Number(v);
    if (/^[A-Z]{3}$/.test(cur) && x > 0 && Number.isFinite(x)) rates[cur] = 1 / x;
  }
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10), rates };
}

export async function fetchRates(timeoutMs = 8000) {
  let last;
  for (const url of RATE_URLS) {
    try {
      return await fetchOne(url, timeoutMs);
    } catch (e) {
      last = e;
      // Netzwerkproblem (Proxy, Firewall, Zertifikat): die zweite Adresse scheitert genauso – nicht nochmals warten
      if (e?.cause || e?.name === 'AbortError') break;
    }
  }
  throw last;
}

/** Übernimmt die geholten Kurse in settings.rates. Liefert Liste der aktualisierten Währungen. */
export function applyRates(settings, fetched) {
  const updated = [];
  const missing = [];
  for (const [cur, r] of Object.entries(settings.rates || {})) {
    if (r.locked) continue;
    const v = fetched.rates[cur];
    if (!v) {
      missing.push(cur);
      continue;
    }
    settings.rates[cur] = { ...r, rate: Math.round(v * 1e6) / 1e6, source: 'EZB ' + fetched.date, updatedAt: new Date().toISOString() };
    updated.push(cur);
  }
  return { updated, missing, date: fetched.date };
}

/** Liste der Währungen, die der Dienst kennt (für die Auswahl in den Einstellungen) */
export const KNOWN = ['AUD', 'BGN', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR'];
