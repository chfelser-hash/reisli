// Benutzer, Passwörter (scrypt) und Sessions (übernommen aus Kässeli).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SESSION_DAYS = 90;

export class Auth {
  constructor(dataDir) {
    this.usersFile = path.join(dataDir, 'users.json');
    this.sessionsFile = path.join(dataDir, 'sessions.json');
    this.users = readJson(this.usersFile, []);
    this.sessions = readJson(this.sessionsFile, {});
    this.failures = new Map(); // ip -> {count, until}
    this.#pruneSessions();
  }

  get hasUsers() {
    return this.users.length > 0;
  }

  listUsers() {
    return this.users.map((u) => ({ id: u.id, name: u.name }));
  }

  createUser(name, password) {
    name = String(name || '').trim();
    if (!name) throw httpError(400, 'Name fehlt');
    if (String(password || '').length < 8) throw httpError(400, 'Passwort muss mindestens 8 Zeichen haben');
    if (this.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) throw httpError(400, 'Benutzer existiert bereits');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: crypto.randomBytes(6).toString('base64url'), name, salt, hash: hashPw(password, salt) };
    this.users.push(user);
    this.#saveUsers();
    return { id: user.id, name: user.name };
  }

  deleteUser(id, currentUserId) {
    if (id === currentUserId) throw httpError(400, 'Du kannst dich nicht selbst löschen');
    this.users = this.users.filter((u) => u.id !== id);
    for (const [t, s] of Object.entries(this.sessions)) if (s.userId === id) delete this.sessions[t];
    this.#saveUsers();
    this.#saveSessions();
  }

  changePassword(userId, oldPw, newPw) {
    const u = this.users.find((x) => x.id === userId);
    if (!u || !verify(oldPw, u)) throw httpError(400, 'Aktuelles Passwort ist falsch');
    if (String(newPw || '').length < 8) throw httpError(400, 'Neues Passwort muss mindestens 8 Zeichen haben');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPw(newPw, u.salt);
    this.#saveUsers();
  }

  login(name, password, ip) {
    const f = this.failures.get(ip);
    if (f && f.count >= 8 && f.until > Date.now()) throw httpError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten nochmals versuchen.');
    const u = this.users.find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
    if (!u || !verify(password, u)) {
      const cur = f && f.until > Date.now() ? f : { count: 0 };
      this.failures.set(ip, { count: cur.count + 1, until: Date.now() + 15 * 60 * 1000 });
      throw httpError(401, 'Name oder Passwort falsch');
    }
    this.failures.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions[token] = { userId: u.id, expires: Date.now() + SESSION_DAYS * 864e5 };
    this.#saveSessions();
    return { token, user: { id: u.id, name: u.name } };
  }

  logout(token) {
    if (token && this.sessions[token]) {
      delete this.sessions[token];
      this.#saveSessions();
    }
  }

  userForToken(token) {
    const s = token && this.sessions[token];
    if (!s || s.expires < Date.now()) return null;
    const u = this.users.find((x) => x.id === s.userId);
    return u ? { id: u.id, name: u.name } : null;
  }

  #pruneSessions() {
    let changed = false;
    for (const [t, s] of Object.entries(this.sessions)) {
      if (s.expires < Date.now()) {
        delete this.sessions[t];
        changed = true;
      }
    }
    if (changed) this.#saveSessions();
  }

  #saveUsers() {
    writeJson(this.usersFile, this.users);
  }

  #saveSessions() {
    writeJson(this.sessionsFile, this.sessions);
  }
}

function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex');
}

function verify(pw, user) {
  const a = Buffer.from(hashPw(pw, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
