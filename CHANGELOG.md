# Änderungen

Neueste Version zuoberst. Format: `## Version – Datum`, darunter je eine Zeile pro Änderung.
Die Version steht auch in `package.json` und unter «Mehr → Über Reisli».

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
