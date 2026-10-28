// Einfacher, robuster JSON-Datenspeicher (Aufbau wie Kässeli).
// - Atomares Schreiben (tmp-Datei + rename), damit bei Stromausfall nichts kaputt geht
// - Tägliche Sicherungskopie in data/backups (die letzten 30 Tage werden behalten)
// - Vor jeder Wiederherstellung wird der aktuelle Stand zusätzlich gesichert
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_CATEGORIES } from '../public/js/calc.js';

const KEEP_DAYS = 30;

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'reisli.json');
    this.backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    if (fs.existsSync(this.file)) return migrate(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    const fresh = migrate({});
    this.#write(fresh);
    return fresh;
  }

  #write(obj) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
    fs.renameSync(tmp, this.file);
  }

  #dailyBackup() {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `reisli-${day}.json`);
    if (!fs.existsSync(target) && fs.existsSync(this.file)) {
      fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(this.backupDir).filter((f) => /^reisli-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const old of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) fs.unlinkSync(path.join(this.backupDir, old));
    }
  }

  get rev() {
    return this.data.rev;
  }

  /** Führt eine Änderung aus und speichert. fn bekommt die Daten und darf sie verändern. */
  mutate(fn) {
    this.#dailyBackup();
    const result = fn(this.data);
    this.data.rev = (this.data.rev || 0) + 1;
    this.data.updatedAt = new Date().toISOString();
    this.#write(this.data);
    return result;
  }

  /** Manuelle Sicherung auf dem Server (z.B. vor grösseren Änderungen) */
  snapshot(label = 'manuell') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `${label}-${stamp}.json`;
    fs.writeFileSync(path.join(this.backupDir, name), JSON.stringify(this.data));
    return name;
  }

  replaceAll(newData) {
    this.#dailyBackup();
    this.snapshot('vor-wiederherstellung');
    const migrated = migrate(newData);
    migrated.rev = (this.data.rev || 0) + 1;
    migrated.updatedAt = new Date().toISOString();
    this.data = migrated;
    this.#write(this.data);
  }

  listBackups() {
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const st = fs.statSync(path.join(this.backupDir, f));
        return { name: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  readBackup(name) {
    if (!/^[\w.-]+\.json$/.test(name)) return null;
    const file = path.join(this.backupDir, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
}

export function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

/** Bringt ältere/importierte Datenstände auf die aktuelle Struktur. */
export function migrate(d) {
  const out = d && typeof d === 'object' ? d : {};
  out.schema = 1;
  out.rev = out.rev || 1;
  out.trips = Array.isArray(out.trips) ? out.trips : [];
  out.settings = out.settings && typeof out.settings === 'object' ? out.settings : {};
  const s = out.settings;
  s.methods = Array.isArray(s.methods) ? s.methods : [
    { id: 'bar', name: 'Bar' },
    { id: 'kreditkarte', name: 'Kreditkarte' },
  ];
  s.categories = Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  s.rates = s.rates && typeof s.rates === 'object' ? s.rates : {
    EUR: { rate: 0.94, source: 'manuell' },
    USD: { rate: 0.8, source: 'manuell' },
  };
  for (const t of out.trips) migrateTrip(t);
  return out;
}

export function migrateTrip(t) {
  t.items = Array.isArray(t.items) ? t.items : [];
  t.days = t.days && typeof t.days === 'object' ? t.days : {};
  t.allowances = Array.isArray(t.allowances) ? t.allowances : [];
  t.split = t.split && typeof t.split === 'object' ? t.split : { enabled: false, participants: [] };
  t.split.participants = Array.isArray(t.split.participants) ? t.split.participants : [];
  t.repayments = Array.isArray(t.repayments) ? t.repayments : [];
  t.travelers = Number(t.travelers) || 2;
  t.currency = t.currency || 'CHF';
  for (const it of t.items) {
    it.payments = Array.isArray(it.payments) ? it.payments : [];
    it.todos = Array.isArray(it.todos) ? it.todos : [];
    it.files = Array.isArray(it.files) ? it.files : [];
    it.plan = it.plan || { amount: 0, currency: 'CHF' };
  }
  return t;
}
