// Erzeugt eine erfundene Outlook-Nachricht (.msg) im Aufbau einer echten Booking.com-Bestätigung.
// Schreibt das «Compound File»-Format selbst (vereinfacht: alle Streams in normalen Sektoren).
// Aufruf: node test/fixtures/make-beispiel-msg.mjs
import fs from 'node:fs';

const u16 = (s) => Buffer.from(s + '\0', 'utf16le');
const body = `<https://booking.com> \t Bestätigungsnummer: 9876543210
PIN: 1357 (Vertraulich)
\t
 <https://secure.booking.com/self_service_tracking_pixel.gif?token=abc>  <https://secure.booking.com/self_service_tracking_pixel.gif?token=def> \t
Vielen Dank, Anna! Ihre Buchung in Rom ist bestätigt.

\t \t Die Unterkunft Albergo Esempio erwartet Sie am Do., 19. Nov.\t

\t \t Mit nur wenigen Klicks können Sie Änderungen an Ihrer Buchung vornehmen <https://secure.booking.com/confirmation.de.html?bn=9876543210&from_conf_email_tracking=1> \t

<https://www.booking.com/hotel/it/albergo-esempio.html>

Albergo Esempio

Ihre Buchung wird mit Booking.com bezahlt

Buchungsinformationen

Anreise\t Donnerstag, 19. November 2026 (14:00 - 20:30)\t
Abreise\t Sonntag, 22. November 2026 (07:30 - 11:00)\t
Ihre Buchung\t 3 Nächte, 2 Zimmer\t
Sie haben gebucht für\t 4 Erwachsene\t
Lage\t Via dell'Esempio 7, Centro, 00100 Roma, Italien
Telefon\t +39 06 0000 0000 <tel:+39%2006%200000%200000> \t

Preisangaben

2 Zimmer
€ 1.000,00
Übernachtungssteuer
€ 72
________________________________

Gesamtpreis
€ 1.172,00

Zahlungsinformationen

Gesamtkosten
€ 1.100,00

Insgesamt bezahlt
€ 1.100,00

Einige Gebühren müssen an die Unterkunft direkt bezahlt werden: \t
Übernachtungssteuer \t€ 72 \t

Stornierungsbedingungen \t
*\tab 6. Oktober 2026 14:50: € 500,00
*\tDiese Buchung ist nicht kostenfrei stornierbar.
`;

const entries = [
  { name: 'Root Entry', type: 5, children: [] },
];
const add = (parent, name, type, data) => {
  const idx = entries.length;
  entries.push({ name, type, data, children: [] });
  entries[parent].children.push(idx);
  return idx;
};
add(0, '__substg1.0_0037001F', 2, u16('🛄 Danke! Ihre Buchung ist bestätigt: Albergo Esempio').subarray(0, -2));
add(0, '__substg1.0_0C1F001F', 2, u16('noreply@booking.com').subarray(0, -2));
add(0, '__substg1.0_1000001F', 2, u16(body).subarray(0, -2));
const att = add(0, '__attach_version1.0_#00000000', 1, null);
add(att, '__substg1.0_3707001F', 2, u16('Unbenannte Anlage 00114.png').subarray(0, -2));
add(att, '__substg1.0_370E001F', 2, u16('image/png').subarray(0, -2));
add(att, '__substg1.0_37010102', 2, Buffer.from('89504e470d0a1a0a', 'hex'));

const SEC = 512;
const secs = (n) => Math.ceil(n / SEC);
const dirSecs = secs(entries.length * 128);
const dataSecs = entries.reduce((a, e) => a + (e.data ? secs(e.data.length) : 0), 0);
let fatSecs = 1;
while (fatSecs * 128 < fatSecs + dirSecs + dataSecs) fatSecs++;
const total = fatSecs + dirSecs + dataSecs;
const fat = new Array(fatSecs * 128).fill(0xffffffff);
for (let i = 0; i < fatSecs; i++) fat[i] = 0xfffffffd;
let next = fatSecs;
const chain = (n) => { const start = next; for (let i = 0; i < n; i++) fat[next + i] = i === n - 1 ? 0xfffffffe : next + i + 1; next += n; return start; };
const dirStart = chain(dirSecs);
for (const e of entries) e.start = e.data && e.data.length ? chain(secs(e.data.length)) : 0xfffffffe;

const out = Buffer.alloc(SEC * (1 + total));
Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(out, 0);
out.writeUInt16LE(0x3e, 0x18); out.writeUInt16LE(3, 0x1a); out.writeUInt16LE(0xfffe, 0x1c);
out.writeUInt16LE(9, 0x1e); out.writeUInt16LE(6, 0x20);
out.writeUInt32LE(fatSecs, 0x2c); out.writeUInt32LE(dirStart, 0x30);
out.writeUInt32LE(0, 0x38); // keine Mini-Streams
out.writeUInt32LE(0xfffffffe, 0x3c); out.writeUInt32LE(0, 0x40); out.writeUInt32LE(0xfffffffe, 0x44); out.writeUInt32LE(0, 0x48);
for (let i = 0; i < 109; i++) out.writeUInt32LE(i < fatSecs ? i : 0xffffffff, 0x4c + i * 4);
const off = (n) => (n + 1) * SEC;
for (let i = 0; i < fat.length; i++) out.writeUInt32LE(fat[i], off(Math.floor(i / 128)) + (i % 128) * 4);
// Geschwister als Kette über «right», Kind = erstes Element
for (const e of entries) e.children.forEach((c, i) => (entries[c].right = e.children[i + 1] ?? 0xffffffff));
entries.forEach((e, i) => {
  const b = off(dirStart) + i * 128;
  const nm = u16(e.name);
  nm.copy(out, b);
  out.writeUInt16LE(nm.length, b + 64);
  out[b + 66] = e.type; out[b + 67] = 1;
  out.writeUInt32LE(0xffffffff, b + 68);
  out.writeUInt32LE(e.right ?? 0xffffffff, b + 72);
  out.writeUInt32LE(e.children.length ? e.children[0] : 0xffffffff, b + 76);
  out.writeUInt32LE(e.type === 2 ? e.start : e.type === 5 ? 0xfffffffe : 0, b + 116);
  out.writeUInt32LE(e.data ? e.data.length : 0, b + 120);
  if (e.data) e.data.copy(out, off(e.start));
});
for (let i = entries.length; i < dirSecs * 4; i++) { const b = off(dirStart) + i * 128; out.writeUInt32LE(0xffffffff, b + 68); out.writeUInt32LE(0xffffffff, b + 72); out.writeUInt32LE(0xffffffff, b + 76); }
fs.writeFileSync(new URL('./mails/booking-de.msg', import.meta.url), out);
console.log('booking-de.msg geschrieben');
