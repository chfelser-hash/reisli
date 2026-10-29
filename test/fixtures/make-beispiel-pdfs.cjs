// Erzeugt erfundene PDF-Beispiele wie aus dem Browser gedruckt (Chromium → eingebettete Schriften mit ToUnicode),
// nachgebaut nach echten Belegen: Booking.com-Zahlungsbeleg (zweispaltig) und Hotel-Voucher (Tabellenkopf + Werte darunter).
// Aufruf: node test/fixtures/make-beispiel-pdfs.cjs   (braucht Playwright)
const path = require('node:path');
const { chromium } = require('playwright');

const css = `body{font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:40px} td{padding:6px 18px 6px 0;vertical-align:top} h2{font-size:15px;margin-top:24px}`;
const docs = {
  'booking-beleg-de.pdf': `<div style="text-align:right">Buchungsnummer<br>1234567890</div>
<h1>Das ist Ihr Zahlungsbeleg</h1>
<h2>IHRE ANGABEN</h2><table>
<tr><td>Name</td><td>Anna Muster</td></tr>
<tr><td>E-Mail-Adresse</td><td>anna@example.org</td></tr>
<tr><td>Datum</td><td>6. Okt. 2026</td></tr></table>
<h2>BUCHUNGSINFORMATIONEN</h2><table>
<tr><td>Name der Unterkunft</td><td>Albergo Esempio</td></tr>
<tr><td>Adresse der Unterkunft</td><td>Via dell'Esempio 7<br><br>Roma, Italy<br><br>00100</td></tr>
<tr><td>Buchungsnummer</td><td>1234567890</td></tr>
<tr><td>Anreise</td><td>Donnerstag, 19. November 2026</td></tr>
<tr><td>Abreise</td><td>Sonntag, 22. November 2026</td></tr>
<tr><td>Am 6. Okt. 2026 bezahlter Betrag</td><td>€ 1.234,56</td></tr></table>
<p>Dies ist ein Transaktionsbeleg – er kann nicht verwendet werden, um die Mehrwertsteuer zurückzufordern.</p>`,
  'voucher-en.pdf': `<h1 style="text-align:center;font-size:18px">Prepaid - Hotel Reservation</h1>
<div style="text-align:center"><b style="font-size:20px">Palm Bay Resort</b><br>12 Moo 4, Tambon Ao-Nang, 81000 Krabi, TH</div><br>
<table><tr><td>Your Reservation</td><td>Check In</td><td>Check Out</td></tr>
<tr><td>2 Nights 1 Room</td><td>18 February 2027</td><td>20 February 2027</td></tr></table>
<table><tr><td>Number of Guests</td><td>Room 1: 2 Adults</td></tr><tr><td>Room Type</td><td>Deluxe Room</td></tr></table>
<table><tr><td>Booking Number</td><td>Confirmation Status</td></tr><tr><td>99887766</td><td>Confirmed</td></tr></table>
<h2>Cancellation Policy</h2><p>Dieses Zimmer ist nicht erstattungsfähig und kann nicht geändert werden.</p>`,
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, html] of Object.entries(docs)) {
    await page.setContent(`<html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
    await page.pdf({ path: path.join(__dirname, 'mails', name), format: 'A4' });
  }
  await browser.close();
  console.log('PDFs geschrieben');
})();
