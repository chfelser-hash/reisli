// Datenschutz-Check: verhindert, dass persönliche Daten ins (öffentliche) Repo gelangen.
// Läuft auf GitHub bei jedem Push und lokal mit «npm run privacy». Prüft alle eingecheckten Dateien:
//  - keine Daten-, Excel-, Sicherungs-, Mail- oder PDF-Dateien ausserhalb der erfundenen Testvorlagen
//  - keine echten E-Mail-Adressen (erlaubt: example.org/.com sowie no-reply-Adressen von Diensten)
//  - keine Kreditkartennummern (Luhn-Prüfung) und keine IBAN
//  - keine persönlichen Begriffe aus der geheimen Liste PRIVATE_PATTERNS (GitHub-Secret, nie im Repo)
// Testvorlagen (PDF, .eml, .msg) werden dafür mit dem Buchungs-Leser in Text umgewandelt.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { readSource } from '../public/js/booking-parse.js';

const files = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
const add = (file, msg) => problems.push(`${file}: ${msg}`);

const FIXTURES = /^test\/fixtures\//;
const FORBIDDEN = /\.(xlsx|xlsm|xls|csv|msg|eml|pdf|ods|numbers)$/i;
const DATA_FILES = /(^|\/)(data\/(?!\.gitkeep$)|reisli-(backup|import|reise)[^/]*\.json$|users\.json$|sessions\.json$)/;
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9-]+\.)+[A-Z]{2,}/gi;
const EMAIL_OK = (e) => /@(example\.(org|com|net)|.*\.example)$/i.test(e) || /^(no-?reply|noreply|donotreply|confirmation|info|support|reservations?|booking|kontakt|service|hello)@/i.test(e) || /^noreply@anthropic\.com$/i.test(e);
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g;
const secret = String(process.env.PRIVATE_PATTERNS || '').split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 3);

function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function scanText(file, text) {
  for (const e of text.match(EMAIL) || []) if (!EMAIL_OK(e)) add(file, `E-Mail-Adresse «${e}» – bitte durch …@example.org ersetzen`);
  // Kartennummern: Viererblöcke (mit gleichem oder ohne Trennzeichen), Luhn-gültig
  for (const m of text.matchAll(/\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits)) add(file, `mögliche Kartennummer «${m[0].trim()}»`);
  }
  for (const m of text.match(IBAN) || []) if (/^(CH|LI|DE|AT|FR|IT)/.test(m)) add(file, `mögliche IBAN «${m}»`);
  for (const p of secret) if (text.toLowerCase().includes(p.toLowerCase())) add(file, 'enthält einen Begriff aus PRIVATE_PATTERNS');
}

for (const file of files) {
  if (DATA_FILES.test(file)) { add(file, 'Daten-/Sicherungsdatei gehört nicht ins Repo'); continue; }
  if (FORBIDDEN.test(file) && !FIXTURES.test(file)) { add(file, 'Excel/CSV/Mail/PDF nur als erfundene Testvorlage unter test/fixtures/ erlaubt'); continue; }
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  if (/\.(pdf|eml|msg)$/i.test(file)) {
    const src = await readSource({ name: file, bytes: new Uint8Array(bytes) });
    scanText(file, `${src.subject}\n${src.from}\n${src.text}`);
    continue;
  }
  if (/\.(png|jpg|jpeg|gif|ico|xlsx|woff2?)$/i.test(file) || bytes.includes(0)) continue; // Binärdateien
  scanText(file, bytes.toString('utf8'));
}

if (problems.length) {
  console.error('Datenschutz-Check: ' + problems.length + ' Problem(e)\n' + problems.map((p) => ' ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log(`Datenschutz-Check: ${files.length} Dateien geprüft – keine persönlichen Daten gefunden${secret.length ? ` (inkl. ${secret.length} geheimer Begriffe)` : ''}.`);
