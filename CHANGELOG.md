# Änderungen

Neueste Version zuoberst. Format: `## Version – Datum`, darunter je eine Zeile pro Änderung.
Die Version steht auch in `package.json` und unter «Mehr → Über Reisli».

## 1.4.0 – 2026-10-31
- Neue Reise: Von–Bis wie in Flux direkt im Kalender antippen (erster Tag, letzter Tag – ohne «OK»), mit Anzahl Tage und Nächte; Wochenenden blass, Tage bestehender Reisen mit Punkt markiert.

## 1.3.1 – 2026-10-29
- Fehler behoben: Buchung importieren legte einen neuen Posten an, obwohl die Unterkunft schon geplant war (ohne Buchungsnummer). Jetzt wird eine Unterkunft in denselben Nächten erkannt und vorgeschlagen; über «Übernehmen in» lässt sich frei wählen: neuer Posten oder ein bestehender.
- «Anzeigen» nach dem Import öffnet den übernommenen Posten direkt.
- Heute → Belege & Tickets: Antippen des Titels öffnet den Posten (dort lassen sich Belege löschen).

## 1.3.0 – 2026-10-29
- Neu: «Mehr → Über Reisli → Nach Updates suchen / Jetzt aktualisieren» – neue Versionen ohne SSH einspielen; Reisli sichert vorher und startet von selbst neu. Zurück zu einer früheren Version ebenfalls möglich.
- Angeboten werden nur Versionen, die auf GitHub alle Tests bestanden haben (automatische Markierung vX.Y.Z).
- Datenschutz-Check auf GitHub: verhindert, dass E-Mail-Adressen, Kartennummern, IBAN, Excel-/Mail-/PDF-Dateien oder geheime Begriffe ins öffentliche Repo gelangen.
- Einmalig nötig: Umstellung auf der NAS per SSH (siehe README, «Aktualisieren über die App»).

## 1.2.0 – 2026-10-29
- Neu: Outlook-Nachrichten (.msg) direkt importieren – auch per Drag & Drop aus Outlook.
- PDF-Import stark verbessert: Belege und Voucher, die im Browser gedruckt wurden («Als PDF speichern») oder eingebettete Schriften nutzen, werden jetzt gelesen; Zeilen und Spalten bleiben erhalten.
- Erkennung verbessert (nach echten Beispielen): Booking.com-Zahlungsbeleg, Hotel-Voucher ohne Beschriftungen (Tabellenkopf mit Werten darunter), mehrzeilige Adressen, «Lage», Buchungsnummer hinter einem Link.
- Teilweise bezahlt (z.B. Kurtaxe direkt an die Unterkunft): Zahlung über den bezahlten Betrag, Rest vor Ort.
- «Nicht erstattungsfähig / nicht kostenfrei stornierbar» wird erkannt und in der Notiz vermerkt; Link zur Buchung statt Tracking-Pixel.

## 1.1.0 – 2026-10-29
- Neu: «Buchung importieren» (im Plan): Bestätigung als E-Mail (.eml), PDF, HTML oder eingefügter Text – Booking.com, Agoda, Hotels.com, trivago, Expedia, Airbnb und Flüge (SWISS, Edelweiss, Thai, Singapore u.a.), deutsch und englisch.
- Feld für Feld übernehmen: jedes erkannte Feld lässt sich abwählen oder korrigieren; Reise wird anhand des Datums vorgeschlagen.
- Bekannte Buchungsnummer → bestehender Posten wird aktualisiert (geänderte Werte vorausgewählt); Stornierungen markieren oder löschen.
- Flüge: ein Posten pro Flug mit Abflug-/Ankunftszeit, Preis und Zahlung beim ersten Flug.
- «Kostenlos stornierbar bis» wird ein To-do mit Fälligkeit, PIN und Gäste kommen in die Notiz, die Bestätigung als Beleg.
- Android: «Teilen → Reisli» öffnet den Import direkt (installierte App über HTTPS).

## 1.0.1 – 2026-10-28
- Fehler behoben: Excel-Import übernahm Zeilen mit Datum ausserhalb der Reise trotz Warnung.
- Fehler behoben: Prognose rechnete falsch, wenn Posten (noch) keine ID hatten (z.B. in einer Vorschau).
- Fehler behoben: Dialoge stahlen beim schnellen Tippen den Fokus; «Abbrechen» buchte beim Kassensturz trotzdem.
- Qualität: Tests für jeden Server-Aufruf, den Excel-Import (mit erfundener Test-Excel), Kurse, Anmeldung und Datenspeicher; Testabdeckung mit Mindestwerten auf GitHub.

## 1.0.0 – 2026-10-28
- Erste Version mit Versionsnummer – ab jetzt sieht man unter «Mehr», welcher Stand läuft, und die App meldet neue Versionen.
- Umfang: Plan mit Zeitstrahl und Übersicht, Erfassen, Zahlungskalender, Vor Ort/Bargeld, To-dos, Auswertung, Kostenaufteilung mit Rückzahlungen, Excel-Import, Kässeli-CSV-Export, tägliche Sicherung.
- Unterwegs-Modus: «Heute» für die laufende bzw. nächste Reise, offline erfassen mit automatischer Übertragung und Konfliktanzeige, Belege offline.
- Reisedokumente für alle Reisen (gruppiert, einklappbar, Gültigkeitswarnung, offline).
- Bargeld-Kasse mit Bezügen, effektivem Kurs und Kassensturz; Schnellrechner ⇄.
- Packliste mit Vorlagen (pro Person, offline abhaken).
- Automatische Tests auf GitHub (Rechenlogik, API, Browser inkl. offline, Docker-Build).
