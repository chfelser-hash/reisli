// Wechselkurse automatisch holen (EZB-Referenzkurse über frankfurter.app, ohne API-Schlüssel).
// Aktualisiert nur Währungen, die in den Einstellungen vorkommen und nicht «fixiert» sind.
// Währungen, die die EZB nicht führt, bleiben unverändert (manuell pflegen).

const URL_LATEST = 'https://api.frankfurter.app/latest?from=CHF';

export async function fetchRates(timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL_LATEST, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Kursdienst antwortet mit ' + res.status);
    const j = await res.json();
    if (!j || typeof j.rates !== 'object') throw new Error('Unerwartete Antwort vom Kursdienst');
    // j.rates: Einheiten pro 1 CHF → wir speichern CHF pro Einheit
    const out = {};
    for (const [cur, perChf] of Object.entries(j.rates)) if (perChf > 0) out[cur] = 1 / perChf;
    return { date: j.date, rates: out };
  } finally {
    clearTimeout(t);
  }
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
