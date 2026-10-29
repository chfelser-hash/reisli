// Aktualisieren über «Mehr → Über Reisli»: holt geprüfte Versionen (Git-Tags vX.Y.Z, die GitHub erst nach grünen
// Tests setzt) aus dem öffentlichen Repo und stellt den Programmordner darauf um. Daten liegen ausserhalb und
// bleiben unberührt; vorher legt der Server eine Sicherung an. Danach startet Reisli neu (Docker übernimmt das).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Ältere Versionen kennen den Update-Knopf noch nicht – dorthin zurück ginge nur per SSH
export const MIN_VERSION = '1.3.0';

const parse = (v) => String(v).replace(/^v/, '').split('.').map(Number);
export const cmpVersion = (a, b) => {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

/** CHANGELOG-Text → [{version, date, changes}] */
export function parseChangelog(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^##\s+(\S+)\s+[–-]\s+(\d{4}-\d{2}-\d{2})/);
    if (m) out.push({ version: m[1], date: m[2], changes: [] });
    else if (out.length && /^\s*-\s+/.test(line)) out[out.length - 1].changes.push(line.replace(/^\s*-\s+/, ''));
  }
  return out;
}

export function createUpdater({ root, version, enabled = true }) {
  const git = (args, timeout = 60000) => new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (e, out, err) => {
      if (e) reject(new Error(String(err || e.message).trim().split('\n').slice(-2).join(' ')));
      else resolve(String(out).trim());
    });
  });
  let busy = false;

  async function tags() {
    const list = (await git(['tag', '--list', 'v*'])).split('\n').map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    return list.filter((t) => cmpVersion(t, MIN_VERSION) >= 0).sort((a, b) => cmpVersion(b, a));
  }

  /** Verfügbare Versionen abfragen (holt vorher die Tags von GitHub) */
  async function check() {
    if (!enabled) return { enabled: false, current: version, reason: 'Aktualisieren über die App ist ausgeschaltet (UPDATE_ENABLED=false).' };
    if (!fs.existsSync(path.join(root, '.git'))) return { enabled: false, current: version, reason: 'Reisli wurde nicht per «git clone» installiert – Updates bitte von Hand einspielen.' };
    try {
      await git(['fetch', '--tags', '--force', '--prune', 'origin'], 90000);
    } catch (e) {
      return { enabled: false, current: version, reason: 'GitHub nicht erreichbar: ' + e.message };
    }
    const all = await tags();
    const newer = all.filter((t) => cmpVersion(t, version) > 0);
    const latest = all[0] || null;
    // Änderungen der neueren Versionen aus dem CHANGELOG der neuesten Version
    let changelog = [];
    if (newer.length) {
      try {
        changelog = parseChangelog(await git(['show', `${latest}:CHANGELOG.md`])).filter((c) => cmpVersion(c.version, version) > 0);
      } catch { /* ohne Änderungsliste */ }
    }
    const dirty = (await git(['status', '--porcelain', '--untracked-files=no']).catch(() => '')).split('\n').filter(Boolean);
    return { enabled: true, current: version, latest, newer: newer.map((t) => t.slice(1)), versions: all.map((t) => t.slice(1)), changelog, dirty };
  }

  /** Auf eine Version umstellen (neuer oder älter) */
  async function apply(target) {
    if (!enabled) throw Object.assign(new Error('Aktualisieren ist ausgeschaltet'), { status: 400 });
    if (!/^\d+\.\d+\.\d+$/.test(String(target || ''))) throw Object.assign(new Error('Version ungültig'), { status: 400 });
    if (busy) throw Object.assign(new Error('Aktualisierung läuft bereits'), { status: 409 });
    busy = true;
    try {
      const tag = 'v' + target;
      if (!(await tags()).includes(tag)) throw Object.assign(new Error(`Version ${target} gibt es nicht (oder sie ist älter als ${MIN_VERSION})`), { status: 400 });
      // Aktueller Zweig zeigt danach auf den Tag – ein späteres «git pull» von Hand bleibt möglich
      await git(['reset', '--hard', tag]);
      return { from: version, to: target };
    } finally {
      busy = false;
    }
  }

  return { check, apply };
}
