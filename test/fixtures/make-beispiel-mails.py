# Erzeugt erfundene Beispiel-Mails (.eml) und ein E-Ticket-PDF für die Tests des Buchungs-Imports.
# Aufruf: python3 test/fixtures/make-beispiel-mails.py
import base64, quopri
from email.message import EmailMessage
from email.policy import SMTP
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

D = Path(__file__).with_name('mails')
D.mkdir(exist_ok=True)

# 1) Booking.com englisch, nur HTML, quoted-printable
html = """<html><body><table>
<tr><td><h1>Thanks, Anna! Your booking in Bangkok is confirmed.</h1></td></tr>
<tr><td><b>Riverside Boutique Hotel</b></td></tr>
<tr><td>Address:</td><td>123 Charoen Krung Road, Bang Rak, 10500 Bangkok, Thailand</td></tr>
<tr><td>Phone:</td><td>+66 2 123 4567</td></tr>
<tr><td>Booking number:</td><td>4711.123.456</td></tr>
<tr><td>PIN code:</td><td>8642</td></tr>
<tr><td>Check-in</td><td>Friday, February 12, 2027 (from 2:00 PM)</td></tr>
<tr><td>Check-out</td><td>Monday, February 15, 2027 (until 12:00 PM)</td></tr>
<tr><td>Total price</td><td>THB&nbsp;9,450</td></tr>
<tr><td>You&#8217;ll pay when you stay at Riverside Boutique Hotel</td></tr>
<tr><td>Free cancellation until February 10, 2027 11:59 PM</td></tr>
<tr><td><a href="https://secure.booking.com/myreservations.html?bn=4711123456">Manage booking</a></td></tr>
</table></body></html>"""
m = EmailMessage(policy=SMTP)
m['From'] = 'Booking.com <noreply@booking.com>'
m['To'] = 'anna@example.org'
m['Subject'] = 'Your booking is confirmed at Riverside Boutique Hotel'
m.set_content(html, subtype='html', cte='quoted-printable')
(D / 'booking-en.eml').write_bytes(m.as_bytes())

# 2) Hotels.com deutsch, Text+HTML, Base64, Betreff mit Umlauten (RFC 2047)
m = EmailMessage(policy=SMTP)
m['From'] = 'Hotels.com <confirmation@hotels.com>'
m['To'] = 'anna@example.org'
m['Subject'] = 'Buchungsbestätigung: Hôtel du Lac Genève'
m.set_content("""Vielen Dank für Ihre Buchung!
Hôtel du Lac Genève
Bestätigungsnummer: 7212345678901
Anreise: Do., 1. Apr. 2027
Abreise: So., 4. Apr. 2027
Adresse: Quai du Mont-Blanc 1, 1201 Genève, Schweiz
Telefon: +41 22 123 45 67
Gesamt: CHF 1'230.00
Bezahlt am 20.01.2027 – vollständig bezahlt.
""", cte='base64')
m.add_alternative('<p>Vielen Dank für Ihre Buchung!</p><p>Hôtel du Lac Genève</p>', subtype='html', cte='base64')
(D / 'hotelscom-de.eml').write_bytes(m.as_bytes())

# 3) Singapore Airlines: kurze Mail mit E-Ticket als PDF-Anhang
pdf = D / 'singapore-eticket.pdf'
c = canvas.Canvas(str(pdf), pagesize=A4, pageCompression=1)
y = 800
for line in ['Singapore Airlines', 'E-Ticket Receipt', 'Booking reference: SQ8M4L', '',
             'SQ 345  Wed 10 Mar 2027  Zurich (ZRH) 11:40 - Singapore (SIN) 06:00 +1',
             'SQ 970  Thu 11 Mar 2027  Singapore (SIN) 08:25 - Bangkok (BKK) 09:50', '',
             'Passenger: MR ANNA MUSTER', 'Total price: CHF 1,512.40']:
    c.drawString(60, y, line)
    y -= 18
c.save()
m = EmailMessage(policy=SMTP)
m['From'] = 'Singapore Airlines <noreply@singaporeair.com>'
m['To'] = 'anna@example.org'
m['Subject'] = 'Your e-ticket'
m.set_content('Please find your e-ticket attached.')
m.add_attachment(pdf.read_bytes(), maintype='application', subtype='pdf', filename='eticket.pdf')
(D / 'singapore-en.eml').write_bytes(m.as_bytes())
print('geschrieben nach', D)
