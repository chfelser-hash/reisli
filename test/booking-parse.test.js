// Buchungsbestätigungen erkennen – mit erfundenen Beispiel-Mails (test/fixtures/mails, erzeugt bzw. von Hand geschrieben)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readSource, parseBooking, findDates, findMoney, parseNumber, htmlToText, parseEml } from '../public/js/booking-parse.js';

const DIR = new URL('./fixtures/mails/', import.meta.url);
async function load(name) {
  const src = await readSource({ name, bytes: new Uint8Array(fs.readFileSync(new URL(name, DIR))) });
  return { src, r: parseBooking(src, 2027) };
}

test('Booking.com deutsch (eingefügter Text): alle Felder', async () => {
  const { r } = await load('booking-de.txt');
  assert.equal(r.provider.name, 'Booking.com');
  assert.equal(r.kind, 'hotel');
  assert.equal(r.status, 'confirmed');
  assert.deepEqual(r.fields, {
    name: 'Riverside Boutique Hotel', checkIn: '2027-02-12', checkInTime: '14:00', checkOut: '2027-02-15', checkOutTime: '12:00',
    bookingRef: '4711.123.456', pin: '8642', address: '123 Charoen Krung Road, Bang Rak, 10500 Bangkok, Thailand', phone: '+66 2 123 4567',
    price: { amount: 9450, currency: 'THB' }, payment: 'vorort', freeCancelUntil: '2027-02-10', guests: 2, rooms: 1,
    link: 'https://secure.booking.com/myreservations.html?bn=4711123456',
  });
  assert.deepEqual(r.warnings, []);
});

test('Booking.com englisch (.eml, nur HTML, quoted-printable, 12h-Zeiten)', async () => {
  const { src, r } = await load('booking-en.eml');
  assert.equal(src.kind, 'eml');
  assert.equal(src.subject, 'Your booking is confirmed at Riverside Boutique Hotel');
  assert.equal(r.fields.name, 'Riverside Boutique Hotel');
  assert.equal(r.fields.checkInTime, '14:00'); // «2:00 PM»
  assert.equal(r.fields.checkOutTime, '12:00'); // «12:00 PM»
  assert.equal(r.fields.payment, 'vorort');
  assert.deepEqual(r.fields.price, { amount: 9450, currency: 'THB' });
});

test('Booking.com Stornierung: erkannt, ohne geratenen Preis', async () => {
  const { r } = await load('booking-storno-de.txt');
  assert.equal(r.status, 'cancelled');
  assert.equal(r.fields.bookingRef, '4711.123.456');
  assert.equal(r.fields.price, undefined);
});

test('Agoda englisch: bezahlt, kostenlos stornierbar', async () => {
  const { r } = await load('agoda-en.txt');
  assert.equal(r.provider.name, 'Agoda');
  assert.equal(r.fields.name, 'Lagoon Dive Resort');
  assert.equal(r.fields.bookingRef, '987654321');
  assert.equal(r.fields.checkIn, '2027-02-15');
  assert.equal(r.fields.checkOut, '2027-02-20');
  assert.equal(r.fields.payment, 'bezahlt');
  assert.deepEqual(r.fields.price, { amount: 12500, currency: 'THB' });
  assert.equal(r.fields.freeCancelUntil, '2027-02-08');
});

test('Hotels.com deutsch (.eml, Base64, Umlaute im Betreff)', async () => {
  const { src, r } = await load('hotelscom-de.eml');
  assert.equal(src.subject, 'Buchungsbestätigung: Hôtel du Lac Genève');
  assert.equal(r.provider.name, 'Hotels.com');
  assert.equal(r.fields.name, 'Hôtel du Lac Genève');
  assert.equal(r.fields.checkIn, '2027-04-01');
  assert.equal(r.fields.checkOut, '2027-04-04');
  assert.deepEqual(r.fields.price, { amount: 1230, currency: 'CHF' });
  assert.equal(r.fields.payment, 'bezahlt');
});

test('trivago deutsch: Euro nach dem Betrag, Zahlung vor Ort', async () => {
  const { r } = await load('trivago-de.txt');
  assert.equal(r.fields.name, 'Casa Mar');
  assert.equal(r.fields.bookingRef, 'TRV-55821');
  assert.deepEqual(r.fields.price, { amount: 248, currency: 'EUR' });
  assert.equal(r.fields.payment, 'vorort');
});

test('SWISS deutsch: Hin- und Rückflug mit Ankunft am Folgetag', async () => {
  const { r } = await load('swiss-de.txt');
  assert.equal(r.kind, 'flight');
  assert.equal(r.fields.bookingRef, 'K7XQ2P');
  assert.deepEqual(r.fields.segments, [
    { flightNo: 'LX 180', date: '2027-02-12', from: 'ZRH', to: 'BKK', dep: '22:40', arr: '15:25', arrNextDay: true },
    { flightNo: 'LX 181', date: '2027-02-28', from: 'BKK', to: 'ZRH', dep: '23:35', arr: '06:15', arrNextDay: true },
  ]);
  assert.deepEqual(r.fields.price, { amount: 1846.3, currency: 'CHF' });
  assert.deepEqual(r.fields.passengers, ['ANNA MUSTER', 'BEN MUSTER']);
});

test('Edelweiss deutsch: Datum «06.10.2027» wird nicht als Uhrzeit gelesen', async () => {
  const { r } = await load('edelweiss-de.txt');
  assert.equal(r.provider.name, 'Edelweiss');
  assert.equal(r.fields.bookingRef, 'EDW9K2');
  assert.deepEqual(r.fields.segments.map((s) => [s.flightNo, s.date, s.from, s.to, s.dep, s.arr, s.arrNextDay]), [
    ['WK 52', '2027-10-06', 'ZRH', 'NRT', '13:15', '08:50', true],
    ['WK 53', '2027-10-20', 'NRT', 'ZRH', '10:50', '17:35', false],
  ]);
});

test('Thai Airways englisch: Tabelle mit Daten wie «16FEB27»', async () => {
  const { r } = await load('thai-en.txt');
  assert.equal(r.fields.bookingRef, '7HRT4D');
  assert.deepEqual(r.fields.segments.map((s) => [s.flightNo, s.date, s.from, s.to, s.dep, s.arr]), [
    ['TG 225', '2027-02-16', 'BKK', 'HKT', '08:05', '09:25'],
    ['TG 226', '2027-02-22', 'HKT', 'BKK', '18:40', '20:05'],
  ]);
  assert.deepEqual(r.fields.price, { amount: 6980, currency: 'THB' });
});

test('Singapore Airlines: Text, PDF-E-Ticket und Mail mit PDF-Anhang liefern dasselbe', async () => {
  const a = (await load('singapore-en.txt')).r;
  const b = (await load('singapore-eticket.pdf')).r;
  const c = (await load('singapore-en.eml')).r;
  for (const r of [a, b, c]) {
    assert.equal(r.kind, 'flight');
    assert.equal(r.fields.bookingRef, 'SQ8M4L');
    assert.deepEqual(r.fields.segments.map((s) => `${s.flightNo} ${s.date} ${s.from}-${s.to} ${s.dep}-${s.arr}`), [
      'SQ 345 2027-03-10 ZRH-SIN 11:40-06:00', 'SQ 970 2027-03-11 SIN-BKK 08:25-09:50',
    ]);
    assert.deepEqual(r.fields.price, { amount: 1512.4, currency: 'CHF' });
  }
});

test('Unbekannter Text: nichts erfunden, Hinweis', async () => {
  const r = parseBooking(await readSource({ text: 'Hallo zusammen, bis bald!' }));
  assert.equal(r.kind, 'unknown');
  assert.ok(r.warnings.length);
});

test('Bausteine: Daten, Beträge, Zahlen, HTML, Mail-Kopfzeilen', () => {
  const d = (s) => findDates(s, 2027).map((x) => x.date);
  assert.deepEqual(d('12.02.2027 · 2027-03-01 · 5. März 2027 · Mar 7, 2027 · 9 April 2027 · 16FEB27 · 3. Mai'), ['2027-02-12', '2027-03-01', '2027-03-05', '2027-03-07', '2027-04-09', '2027-02-16', '2027-05-03']);
  assert.deepEqual(findMoney('CHF 1\'846.30 · 248,00 € · THB 12,500.00 · US$ 99 · 1.234,56 EUR').map((m) => `${m.amount} ${m.currency}`), ['1846.3 CHF', '248 EUR', '12500 THB', '99 USD', '1234.56 EUR']);
  assert.equal(parseNumber('9 000'), 9000);
  assert.equal(parseNumber('1.234'), 1234);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(htmlToText('<p>A&nbsp;&amp;&nbsp;B</p><table><tr><td>x</td><td>y</td></tr></table>'), 'A & B\nx y');
  const m = parseEml('Subject: =?utf-8?Q?Best=C3=A4tigung?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo');
  assert.equal(m.subject, 'Bestätigung');
  assert.equal(m.text, 'Hallo');
});
