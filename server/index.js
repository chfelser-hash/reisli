// Reisli – Ferienbudget. Server ohne externe Abhängigkeiten (nur Node.js >= 20), Aufbau wie Kässeli.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId, migrateTrip } from './store.js';
import { Auth, httpError } from './auth.js';
import { cleanItem, cleanTripMeta, cleanDay, cleanTrip, cleanSettings, cleanRepayment, cleanDocument, cleanCash, cleanPackItem, isDate, str } from './clean.js';
import { importTripFromExcel, applySettingsPatch } from './excel-import.js';
import { fetchRates, applyRates, toChfPerUnit, describeFetchError, KNOWN, RATE_URLS } from './rates.js';
import { copyTrip, tripCsv, mergeItems } from '../public/js/calc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';
const AUTO_RATES = process.env.AUTO_RATES !== 'false';
const MAX_FILE = 15 * 1024 * 1024;
// Version aus package.json, Änderungsliste aus CHANGELOG.md
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
function readChangelog() {
  try {
    const out = [];
    for (const line of fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^##\s+(\S+)\s+[–-]\s+(\d{4}-\d{2}-\d{2})/);
      if (m) out.push({ version: m[1], date: m[2], changes: [] });
      else if (out.length && /^\s*-\s+/.test(line)) out[out.length - 1].changes.push(line.replace(/^\s*-\s+/, ''));
    }
    return out;
  } catch { return []; }
}
const CHANGELOG = readChangelog();
const VERSION_DATE = CHANGELOG.find((x) => x.version === VERSION)?.date || '';

fs.mkdirSync(FILES_DIR, { recursive: true });
const store = new Store(DATA_DIR);
const auth = new Auth(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- Hilfsfunktionen ----------
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'Datei zu gross (max. ' + Math.round(limit / 1048576) + ' MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req, limit = 200 * 1024 * 1024) {
  const buf = await readRaw(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw httpError(400, 'Ungültiges JSON');
  }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, token, maxAge) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  return `rsid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const fileName = (req) => {
  try {
    // Der Browser schickt den Namen URL-kodiert; rohe UTF-8-Header kommen als latin1 an
    const raw = Buffer.from(String(req.headers['x-file-name'] || 'datei'), 'latin1').toString('utf8');
    return decodeURIComponent(raw).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160);
  } catch {
    return 'datei';
  }
};
const attachment = (name) => `attachment; filename="${name.replace(/[^\w.\- ]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

function publicData(user) {
  const d = store.data;
  return { rev: d.rev, updatedAt: d.updatedAt, trips: d.trips, documents: d.documents, settings: d.settings, user, users: auth.listUsers(), knownCurrencies: KNOWN, autoRates: AUTO_RATES, rateUrl: RATE_URLS[0], version: VERSION, versionDate: VERSION_DATE };
}

function findTrip(d, tripId) {
  const t = d.trips.find((x) => x.id === tripId);
  if (!t) throw httpError(404, 'Reise nicht gefunden');
  return t;
}
function findItem(t, itemId) {
  const it = t.items.find((x) => x.id === itemId);
  if (!it) throw httpError(404, 'Posten nicht gefunden');
  return it;
}

const filePath = (fileId) => {
  if (!/^[\w-]{1,40}$/.test(fileId)) throw httpError(400, 'Ungültige Datei');
  return path.join(FILES_DIR, fileId);
};
/**
 * Belege werden beim Löschen NICHT sofort entfernt: Belege ändern sich nie, darum genügt eine einzige Kopie,
 * solange der aktuelle Stand oder irgendeine Sicherung in data/backups noch darauf verweist. So stellt jede
 * Wiederherstellung auch die Belege wieder her – ohne dass etwas doppelt gespeichert wird.
 *
 * Löscht Belege, auf die weder der aktuelle Stand noch eine Sicherung verweist (und die älter als 2 Tage sind). */
function cleanupFiles() {
  const used = new Set();
  const collect = (data) => {
    for (const t of data?.trips || []) for (const it of t.items || []) for (const f of it.files || []) if (f?.id) used.add(f.id);
    for (const doc of data?.documents || []) for (const f of doc.files || []) if (f?.id) used.add(f.id);
  };
  collect(store.data);
  for (const b of store.listBackups()) {
    try { collect(store.readBackup(b.name)); } catch { /* defekte Sicherung: zur Sicherheit nichts löschen */ return { removed: 0, skipped: true }; }
  }
  let removed = 0, bytes = 0;
  const minAge = Date.now() - 2 * 864e5;
  for (const name of fs.readdirSync(FILES_DIR)) {
    if (used.has(name) || !/^[\w-]{1,40}$/.test(name)) continue;
    const file = path.join(FILES_DIR, name);
    try {
      const st = fs.statSync(file);
      if (st.mtimeMs > minAge) continue;
      fs.unlinkSync(file);
      removed++;
      bytes += st.size;
    } catch { /* egal */ }
  }
  if (removed) console.log(`Belege aufgeräumt: ${removed} Datei(en), ${Math.round(bytes / 1024)} KB`);
  return { removed, bytes };
}

/** Komplette Sicherung, optional inkl. Belege (Base64) */
function backupPayload(withFiles) {
  const { trips, settings, documents } = store.data;
  const out = { app: 'reisli', schema: 1, exportedAt: new Date().toISOString(), trips, documents, docsSchema: store.data.docsSchema, settings };
  if (withFiles) {
    out.files = {};
    const all = [...trips.flatMap((t) => t.items.flatMap((it) => it.files || [])), ...documents.flatMap((doc) => doc.files || [])];
    for (const f of all) {
      try {
        out.files[f.id] = fs.readFileSync(filePath(f.id)).toString('base64');
      } catch { /* fehlende Datei überspringen */ }
    }
  }
  return out;
}

function restoreFiles(files) {
  let n = 0;
  for (const [fid, b64] of Object.entries(files || {})) {
    if (!/^[\w-]{1,40}$/.test(fid) || typeof b64 !== 'string') continue;
    fs.writeFileSync(filePath(fid), Buffer.from(b64, 'base64'));
    n++;
  }
  return n;
}

/** Eine importierte Reise bringt keine Dateien mit → Beleg-Verweise entfernen */
function withoutFiles(trip) {
  for (const it of trip.items) it.files = [];
  return trip;
}

const defaultAllowances = () => [
  { id: newId(), label: 'Essen & Trinken', catId: 'essen', amount: 80, currency: 'CHF', mode: 'tag', per: 'tag' },
  { id: newId(), label: 'Unterkunft', catId: 'unterkunft', amount: 100, currency: 'CHF', mode: 'platzhalter', per: 'nacht' },
];

// ---------- Wechselkurse ----------
let lastRateRun = 0;
async function refreshRates(force = false) {
  if (!force && Date.now() - lastRateRun < 20 * 3600e3) return null;
  lastRateRun = Date.now();
  const fetched = await fetchRates();
  let result;
  store.mutate((d) => {
    result = applyRates(d.settings, fetched);
    d.settings.ratesFetchedAt = new Date().toISOString();
  });
  return result;
}

// ---------- API ----------
async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  // Schutz gegen Cross-Site-Requests: alle schreibenden Aufrufe brauchen diesen Header
  if (method !== 'GET' && req.headers['x-reisli'] !== '1') throw httpError(403, 'Fehlender Header');

  if (p === '/api/status' && method === 'GET') {
    const user = auth.userForToken(cookies(req).rsid);
    return send(res, 200, { needsSetup: !auth.hasUsers, user, version: VERSION });
  }
  if (p === '/api/setup' && method === 'POST') {
    if (auth.hasUsers) throw httpError(403, 'Bereits eingerichtet');
    const b = await readBody(req);
    auth.createUser(b.name, b.password);
    const { token, user } = auth.login(b.name, b.password, clientIp(req));
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token, 90 * 86400) });
  }
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const { token, user } = auth.login(b.name, b.password, clientIp(req));
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(req, token, 90 * 86400) });
  }
  if (p === '/api/logout' && method === 'POST') {
    auth.logout(cookies(req).rsid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Ab hier nur angemeldet
  const user = auth.userForToken(cookies(req).rsid);
  if (!user) throw httpError(401, 'Nicht angemeldet');

  if (p === '/api/data' && method === 'GET') return send(res, 200, publicData(user));
  if (p === '/api/rev' && method === 'GET') return send(res, 200, { rev: store.rev, version: VERSION });
  if (p === '/api/changelog' && method === 'GET') return send(res, 200, { version: VERSION, date: VERSION_DATE, changelog: CHANGELOG.slice(0, 20) });

  // ----- Reisen -----
  if (p === '/api/trips' && method === 'POST') {
    const b = await readBody(req);
    const trip = store.mutate((d) => {
      const t = migrateTrip({ id: newId(), ...cleanTripMeta({ allowances: defaultAllowances(), ...b }), days: {}, items: [], createdAt: new Date().toISOString() });
      d.trips.push(t);
      return t;
    });
    return send(res, 200, { rev: store.rev, trip });
  }
  let m = p.match(/^\/api\/trips\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const trip = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      Object.assign(t, cleanTripMeta(b, t));
      return t;
    });
    return send(res, 200, { rev: store.rev, trip });
  }
  if (m && method === 'DELETE') {
    // Sicherheitsnetz: vorher eine eigene Sicherung anlegen. Belege bleiben auf der Platte,
    // damit eine Wiederherstellung sie wieder findet.
    const t0 = findTrip(store.data, m[1]);
    const label = 'vor-loeschen-' + t0.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const backup = store.snapshot(label);
    store.mutate((d) => {
      d.trips = d.trips.filter((x) => x.id !== m[1]);
    });
    return send(res, 200, { rev: store.rev, backup });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/copy$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    if (b.start && !isDate(b.start)) throw httpError(400, 'Startdatum ungültig');
    const trip = store.mutate((d) => {
      const t = copyTrip(findTrip(d, m[1]), { name: str(b.name, 80).trim(), start: b.start, keepItems: b.keepItems !== false, newId });
      d.trips.push(migrateTrip(t));
      return t;
    });
    return send(res, 200, { rev: store.rev, trip });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/assign-payer$/);
  if (m && method === 'POST') {
    // Kostenaufteilung nachträglich eingeschaltet: bisherige Zahlungen ohne «bezahlt von» einer Person zuordnen
    const b = await readBody(req);
    const count = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      if (!t.split.participants.some((x) => x.id === b.paidBy)) throw httpError(400, 'Person unbekannt');
      let n = 0;
      for (const it of t.items) for (const pay of it.payments) if (!pay.paidBy) { pay.paidBy = b.paidBy; n++; }
      return n;
    });
    return send(res, 200, { rev: store.rev, count, trip: findTrip(store.data, m[1]) });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/days-currency$/);
  if (m && method === 'POST') {
    // Währung vor Ort für einen Bereich von Tagen setzen
    const b = await readBody(req);
    if (!isDate(b.from) || !isDate(b.to) || b.to < b.from) throw httpError(400, 'Zeitraum ungültig');
    const cur = typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : '';
    const days = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      for (let x = b.from; x <= b.to; x = new Date(Date.parse(x) + 864e5).toISOString().slice(0, 10)) {
        t.days[x] = cleanDay({ ...(t.days[x] || {}), currency: cur });
      }
      return t.days;
    });
    return send(res, 200, { rev: store.rev, days });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const day = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      t.days[m[2]] = cleanDay(b);
      return t.days[m[2]];
    });
    return send(res, 200, { rev: store.rev, day });
  }

  // ----- Rückzahlungen (Kostenaufteilung) -----
  // ----- Packliste (einzeln änderbar, damit Abhaken auch offline und auf zwei Handys klappt) -----
  m = p.match(/^\/api\/trips\/([\w-]+)\/packing$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const list = (Array.isArray(b) ? b : [b]).slice(0, 500);
    const created = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const out = [];
      for (const x of list) {
        const c = cleanPackItem(x);
        const dup = t.packing.find((y) => y.id === c.id);
        if (dup) { out.push(dup); continue; }
        t.packing.push(c);
        out.push(c);
      }
      return out;
    });
    return send(res, 200, { rev: store.rev, created });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/packing\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const item = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const i = t.packing.findIndex((x) => x.id === m[2]);
      if (i < 0) return null; // inzwischen gelöscht – nicht schlimm
      t.packing[i] = cleanPackItem({ ...t.packing[i], ...b, id: m[2] });
      return t.packing[i];
    });
    return send(res, 200, { rev: store.rev, item });
  }
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const t = findTrip(d, m[1]);
      t.packing = t.packing.filter((x) => x.id !== m[2]);
    });
    return send(res, 200, { rev: store.rev });
  }

  // ----- Bargeld-Kasse -----
  m = p.match(/^\/api\/trips\/([\w-]+)\/cash$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const entry = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const c = { ...cleanCash(b), by: user.name, createdAt: new Date().toISOString() };
      const dup = t.cash.find((x) => x.id === c.id); // offline doppelt gesendet
      if (dup) return dup;
      t.cash.push(c);
      return c;
    });
    return send(res, 200, { rev: store.rev, entry });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/cash\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const t = findTrip(d, m[1]);
      t.cash = t.cash.filter((x) => x.id !== m[2]);
    });
    return send(res, 200, { rev: store.rev });
  }

  m = p.match(/^\/api\/trips\/([\w-]+)\/repayments$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const r = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const ids = new Set(t.split.participants.map((x) => x.id));
      const rep = { ...cleanRepayment(b), by: user.name, createdAt: new Date().toISOString() };
      if (!ids.has(rep.from) || !ids.has(rep.to)) throw httpError(400, 'Person unbekannt');
      const dup = t.repayments.find((x) => x.id === rep.id);
      if (dup) return dup;
      t.repayments.push(rep);
      return rep;
    });
    return send(res, 200, { rev: store.rev, repayment: r });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/repayments\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const t = findTrip(d, m[1]);
      t.repayments = t.repayments.filter((x) => x.id !== m[2]);
    });
    return send(res, 200, { rev: store.rev });
  }

  // ----- Posten -----
  m = p.match(/^\/api\/trips\/([\w-]+)\/items$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const list = Array.isArray(b) ? b : [b];
    const created = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      // Eine gültige Browser-ID wird übernommen: so ist das Nachsenden aus dem Offline-Speicher idempotent
      const have = new Set(t.items.map((x) => x.id));
      const out = [];
      for (const x of list) {
        const keep = typeof x.id === 'string' && /^[\w-]{8,40}$/.test(x.id);
        if (keep && have.has(x.id)) { out.push(t.items.find((y) => y.id === x.id)); continue; }
        const it = cleanItem({ ...x, id: keep ? x.id : undefined }, user);
        t.items.push(it);
        have.add(it.id);
        out.push(it);
      }
      return out;
    });
    return send(res, 200, { rev: store.rev, created });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/items\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const item = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const i = t.items.findIndex((x) => x.id === m[2]);
      if (i < 0) throw httpError(404, 'Posten nicht gefunden');
      // Offline bearbeitet: wurde der Posten inzwischen auf dem anderen Gerät geändert? → Konflikt melden
      const cur = t.items[i];
      if (b.baseUpdatedAt && b.baseUpdatedAt !== (cur.updatedAt || cur.createdAt)) {
        throw Object.assign(httpError(409, 'Posten wurde inzwischen geändert'), { extra: { item: cur } });
      }
      t.items[i] = cleanItem(b, user, cur);
      return t.items[i];
    });
    return send(res, 200, { rev: store.rev, item });
  }
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const t = findTrip(d, m[1]);
      // Bereits gelöscht (z.B. doppelt nachgesendet) ist kein Fehler
      t.items = t.items.filter((x) => x.id !== m[2]);
    });
    return send(res, 200, { rev: store.rev });
  }

  m = p.match(/^\/api\/trips\/([\w-]+)\/items\/([\w-]+)\/merge$/);
  if (m && method === 'POST') {
    // Zwei Posten zu einem zusammenführen (z.B. Anzahlung + Restzahlung); der andere wird entfernt, Belege wandern mit
    const b = await readBody(req);
    const item = store.mutate((d) => {
      const t = findTrip(d, m[1]);
      const target = findItem(t, m[2]);
      const other = findItem(t, str(b.otherId, 40));
      if (target.id === other.id) throw httpError(400, 'Ein Posten kann nicht mit sich selbst zusammengeführt werden');
      const merged = mergeItems(d.settings, target, other);
      const clean = cleanItem(merged, user, target);
      clean.files = merged.files;
      t.items = t.items.filter((x) => x.id !== other.id).map((x) => (x.id === target.id ? clean : x));
      return clean;
    });
    return send(res, 200, { rev: store.rev, item });
  }

  // ----- Belege (Dateien) -----
  m = p.match(/^\/api\/trips\/([\w-]+)\/items\/([\w-]+)\/files$/);
  if (m && method === 'POST') {
    const buf = await readRaw(req, MAX_FILE);
    if (!buf.length) throw httpError(400, 'Leere Datei');
    const meta = { id: newId(), name: fileName(req), size: buf.length, type: str(req.headers['content-type'], 80) || 'application/octet-stream', at: new Date().toISOString(), by: user.name };
    // Zuerst prüfen, ob es den Posten gibt, dann Datei schreiben, dann Metadaten speichern
    findItem(findTrip(store.data, m[1]), m[2]);
    fs.writeFileSync(filePath(meta.id), buf);
    store.mutate((d) => findItem(findTrip(d, m[1]), m[2]).files.push(meta));
    return send(res, 200, { rev: store.rev, file: meta });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/items\/([\w-]+)\/files\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const it = findItem(findTrip(d, m[1]), m[2]);
      it.files = it.files.filter((f) => f.id !== m[3]);
    });
    return send(res, 200, { rev: store.rev });
  }
  // ----- Allgemeine Reisedokumente -----
  if (p === '/api/documents' && method === 'POST') {
    const b = await readBody(req);
    const doc = store.mutate((d) => {
      const x = cleanDocument(b, user);
      d.documents.push(x);
      return x;
    });
    return send(res, 200, { rev: store.rev, document: doc });
  }
  m = p.match(/^\/api\/documents\/([\w-]+)$/);
  const findDoc = (d, docId) => {
    const x = d.documents.find((y) => y.id === docId);
    if (!x) throw httpError(404, 'Dokument nicht gefunden');
    return x;
  };
  if (m && method === 'PUT') {
    const b = await readBody(req);
    const doc = store.mutate((d) => {
      const cur = findDoc(d, m[1]);
      const x = cleanDocument(b, user, cur);
      d.documents[d.documents.indexOf(cur)] = x;
      return x;
    });
    return send(res, 200, { rev: store.rev, document: doc });
  }
  if (m && method === 'DELETE') {
    store.mutate((d) => (d.documents = d.documents.filter((x) => x.id !== m[1])));
    return send(res, 200, { rev: store.rev });
  }
  m = p.match(/^\/api\/documents\/([\w-]+)\/files$/);
  if (m && method === 'POST') {
    const buf = await readRaw(req, MAX_FILE);
    if (!buf.length) throw httpError(400, 'Leere Datei');
    const meta = { id: newId(), name: fileName(req), size: buf.length, type: str(req.headers['content-type'], 80) || 'application/octet-stream', at: new Date().toISOString(), by: user.name };
    findDoc(store.data, m[1]);
    fs.writeFileSync(filePath(meta.id), buf);
    store.mutate((d) => findDoc(d, m[1]).files.push(meta));
    return send(res, 200, { rev: store.rev, file: meta });
  }
  m = p.match(/^\/api\/documents\/([\w-]+)\/files\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    store.mutate((d) => {
      const doc = findDoc(d, m[1]);
      doc.files = doc.files.filter((f) => f.id !== m[2]);
    });
    return send(res, 200, { rev: store.rev });
  }
  m = p.match(/^\/api\/files\/([\w-]+)$/);
  if (m && method === 'GET') {
    let meta = null;
    for (const t of store.data.trips) for (const it of t.items) for (const f of it.files || []) if (f.id === m[1]) meta = f;
    for (const doc of store.data.documents) for (const f of doc.files || []) if (f.id === m[1]) meta = f;
    if (!meta) throw httpError(404, 'Beleg nicht gefunden');
    const buf = fs.readFileSync(filePath(meta.id));
    const inline = /^(image\/|application\/pdf)/.test(meta.type) && url.searchParams.get('download') !== '1';
    return send(res, 200, buf, {
      'Content-Type': meta.type,
      'Content-Disposition': inline ? `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}` : attachment(meta.name),
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf",
    });
  }

  // ----- Einstellungen & Kurse -----
  if (p === '/api/settings' && method === 'PUT') {
    const b = await readBody(req);
    const settings = store.mutate((d) => (d.settings = cleanSettings(b, d.settings)));
    return send(res, 200, { rev: store.rev, settings });
  }
  if (p === '/api/methods/replace' && method === 'POST') {
    // Bezahlmethode überall ersetzen (z.B. vor dem Löschen oder für verwaiste Einträge); to '' = ohne Methode
    const b = await readBody(req);
    const from = str(b.from, 40);
    const to = str(b.to, 40);
    if (!from) throw httpError(400, 'Methode fehlt');
    const count = store.mutate((d) => {
      let n = 0;
      for (const t of d.trips) for (const it of t.items) {
        if (it.dueMethodId === from) { it.dueMethodId = to; n++; }
        for (const pay of it.payments) if (pay.methodId === from) { pay.methodId = to; n++; }
      }
      return n;
    });
    return send(res, 200, { rev: store.rev, count });
  }
  if (p === '/api/rates/refresh' && method === 'POST') {
    try {
      const result = await refreshRates(true);
      return send(res, 200, { rev: store.rev, ...result, settings: store.data.settings });
    } catch (e) {
      // Der Browser versucht es danach selbst (siehe /api/rates/apply)
      throw httpError(502, 'Server konnte die Kurse nicht holen: ' + describeFetchError(e));
    }
  }
  if (p === '/api/rates/apply' && method === 'POST') {
    // Kurse, die der Browser selbst geholt hat (z.B. weil der Server hinter einem Firmen-Proxy steckt)
    const b = await readBody(req);
    const fetched = toChfPerUnit(b.date, b.rates);
    if (!Object.keys(fetched.rates).length) throw httpError(400, 'Keine Kurse erhalten');
    let result;
    store.mutate((d) => {
      result = applyRates(d.settings, fetched);
      d.settings.ratesFetchedAt = new Date().toISOString();
    });
    lastRateRun = Date.now();
    return send(res, 200, { rev: store.rev, ...result, via: 'browser', settings: store.data.settings });
  }

  // ----- Import & Export -----
  if (p === '/api/import/excel' && method === 'POST') {
    const buf = await readRaw(req, 20 * 1024 * 1024);
    let result;
    try {
      result = importTripFromExcel(buf, { fileName: fileName(req), settings: store.data.settings, newId });
    } catch (e) {
      throw httpError(400, 'Excel konnte nicht gelesen werden: ' + e.message);
    }
    return send(res, 200, result); // Vorschau – gespeichert wird erst mit /api/import/commit
  }
  if (p === '/api/import/commit' && method === 'POST') {
    const b = await readBody(req);
    const trip = withoutFiles(cleanTrip({ ...b.trip, id: newId() }, user));
    let added;
    store.mutate((d) => {
      if (b.settingsPatch) added = applySettingsPatch(d.settings, b.settingsPatch);
      d.trips.push(trip);
    });
    return send(res, 200, { rev: store.rev, trip, added });
  }
  m = p.match(/^\/api\/trips\/([\w-]+)\/export\.(json|csv)$/);
  if (m && method === 'GET') {
    const t = findTrip(store.data, m[1]);
    const base = 'reisli-reise-' + t.name.replace(/[^\wäöüÄÖÜ-]+/g, '_');
    if (m[2] === 'csv') return send(res, 200, tripCsv(store.data.settings, t), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': attachment(base + '.csv') });
    const s = store.data.settings;
    return send(res, 200, JSON.stringify({ app: 'reisli', kind: 'trip', exportedAt: new Date().toISOString(), trip: t, settingsPatch: { methods: s.methods, rates: Object.fromEntries(Object.entries(s.rates).map(([k, v]) => [k, v.rate])), categories: s.categories } }, null, 1), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(base + '.json'),
    });
  }

  // ----- Benutzer -----
  if (p === '/api/users' && method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, auth.createUser(b.name, b.password));
  }
  m = p.match(/^\/api\/users\/([\w-]+)$/);
  if (m && method === 'DELETE') {
    auth.deleteUser(m[1], user.id);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && method === 'POST') {
    const b = await readBody(req);
    auth.changePassword(user.id, b.oldPassword, b.newPassword);
    return send(res, 200, { ok: true });
  }

  // ----- Sicherung -----
  if (p === '/api/backup' && method === 'GET') {
    const withFiles = url.searchParams.get('files') === '1';
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, JSON.stringify(backupPayload(withFiles)), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': attachment(`reisli-backup-${day}${withFiles ? '-mit-belegen' : ''}.json`),
    });
  }
  if (p === '/api/restore' && method === 'POST') {
    const b = await readBody(req);
    if (b?.kind === 'trip' && b.trip) {
      // Einzelne Reise aus einer Reise-Sicherung hinzufügen
      const trip = withoutFiles(cleanTrip({ ...b.trip, id: newId() }, user));
      store.mutate((d) => {
        if (b.settingsPatch) applySettingsPatch(d.settings, b.settingsPatch);
        d.trips.push(trip);
      });
      return send(res, 200, { rev: store.rev, mode: 'trip', trip });
    }
    if (!b || !Array.isArray(b.trips) || typeof b.settings !== 'object') throw httpError(400, 'Keine gültige Reisli-Sicherung');
    const trips = b.trips.map((t) => cleanTrip(t, user));
    const documents = Array.isArray(b.documents) ? b.documents.flatMap((x) => { try { return [{ ...cleanDocument(x, user), files: Array.isArray(x.files) ? x.files.filter((f) => f && /^[\w-]+$/.test(f.id)).map((f) => ({ id: f.id, name: str(f.name, 160), size: Number(f.size) || 0, type: str(f.type, 80) })) : [] }]; } catch { return []; } }) : store.data.documents;
    store.replaceAll({ trips, documents, docsSchema: Array.isArray(b.documents) ? b.docsSchema : store.data.docsSchema, settings: cleanSettings(b.settings, store.data.settings) });
    const files = restoreFiles(b.files);
    return send(res, 200, { rev: store.rev, mode: 'all', trips: trips.length, files });
  }
  if (p === '/api/backups' && method === 'GET') {
    let filesBytes = 0, filesCount = 0;
    for (const n of fs.readdirSync(FILES_DIR)) {
      try { filesBytes += fs.statSync(path.join(FILES_DIR, n)).size; filesCount++; } catch { /* egal */ }
    }
    return send(res, 200, { backups: store.listBackups(), files: { count: filesCount, bytes: filesBytes } });
  }
  if (p === '/api/backups' && method === 'POST') {
    const name = store.snapshot('manuell');
    return send(res, 200, { name, backups: store.listBackups() });
  }
  m = p.match(/^\/api\/backups\/([\w.-]+\.json)$/);
  if (m && method === 'GET') {
    const data = store.readBackup(m[1]);
    if (!data) throw httpError(404, 'Sicherung nicht gefunden');
    return send(res, 200, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': attachment(m[1]) });
  }
  m = p.match(/^\/api\/backups\/([\w.-]+\.json)\/restore$/);
  if (m && method === 'POST') {
    const data = store.readBackup(m[1]);
    if (!data) throw httpError(404, 'Sicherung nicht gefunden');
    store.replaceAll(data);
    return send(res, 200, { rev: store.rev });
  }

  throw httpError(404, 'Unbekannter API-Aufruf');
}

// ---------- Statische Dateien ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Verboten');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Nicht gefunden');
    const ext = path.extname(file);
    // Service Worker: Cache-Name an die Version koppeln → jede neue Version lädt die Oberfläche frisch
    if (rel === '/sw.js') buf = Buffer.from(buf.toString('utf8').replaceAll('__VERSION__', VERSION));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // HTML/JS/CSS immer frisch prüfen, damit Updates sofort ankommen
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.frankfurter.dev; manifest-src 'self'; worker-src 'self'; frame-src 'self'"
  );
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Interner Fehler' : e.message, ...(e.extra || {}) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Reisli läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})`);
  if (!auth.hasUsers) console.log('Noch kein Benutzer vorhanden – beim ersten Aufruf wird ein Konto angelegt.');
});

// Belege aufräumen: kurz nach dem Start und danach täglich
setTimeout(() => { try { cleanupFiles(); } catch (e) { console.log('Belege aufräumen fehlgeschlagen:', e.message); } }, 15000).unref();
setInterval(() => { try { cleanupFiles(); } catch (e) { console.log('Belege aufräumen fehlgeschlagen:', e.message); } }, 24 * 3600e3).unref();

// Kurse beim Start und danach alle 6 Stunden prüfen (holt höchstens einmal pro Tag)
if (AUTO_RATES) {
  const run = () => refreshRates().then((r) => r && console.log(`Kurse aktualisiert (${r.date}): ${r.updated.join(', ') || '–'}`)).catch((e) => console.log('Kurse nicht vom Server aktualisiert:', describeFetchError(e), '– die App holt sie dann über den Browser.'));
  setTimeout(run, 5000);
  setInterval(run, 6 * 3600e3).unref();
}

// Sauber beenden (Docker stop, Ctrl+C): laufende Anfragen fertig, dann aus
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

// Für die Tests: Server im selben Prozess starten und wieder schliessen
export { server, cleanupFiles };
