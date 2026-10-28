# Reisli

Ferienbudget als Web-App – Nachfolger der Ferien-Excel, Geschwister vom [Kässeli](https://github.com/chfelser-hash/kaesseli).
Läuft im Browser auf Windows und Android (installierbar als App), die Daten liegen auf der eigenen Synology NAS.

- **Reise-Auswahl** (oben rechts) – Name und Zeitspanne, gruppiert nach laufend/kommend, vergangen und Archiv. «+ Neue Reise» öffnet ein eigenes Fenster: leer, als Kopie einer bestehenden Reise oder aus der Excel.
- **Heute** (immer für die laufende bzw. nächste Reise; während der Reise auch Startansicht) – der Tag auf einen Blick: Unterkunft mit Adresse (Karte), Telefon und Buchungsnummer, Programm mit Zeiten, Belege und Tickets zum Antippen, Tagesbudget, was vor Ort noch zu bezahlen ist. Mit ‹ › durch die Tage blättern. **Funktioniert auch offline** (siehe unten).
- **Plan** – Reiseablauf Tag für Tag: Programm, Ort, Unterkunft (über mehrere Nächte), Posten mit Status und Betrag in Lokalwährung + CHF, Pauschalen. Ein **Zeitstrahl** springt zu jedem Tag. Umschaltbar auf eine kompakte **Übersicht** wie im Excel. Oben: Prognose total, pro Person, bezahlt, noch offen, Countdown und ✎ **Reise bearbeiten** (Daten, Pauschalen, Kostenaufteilung, Kopieren, Archivieren, Löschen).
- **Erfassen** – Unterwegs-Modus: Tag auf dem Zeitstrahl antippen, Betrag (darf gerechnet werden: `300+150`), Währung, Kategorie, fertig. **Schnellknöpfe** mit den häufigsten Ausgaben der Reise. Zeigt das Tagesbudget («Essen: 23 von 80 CHF»).
- **Offen**
  - **Zahlungskalender** – was ist wann fällig und von welchem Konto, mit «✓ bezahlt»-Knopf.
  - **Vor Ort / Bargeld** – was noch vor Ort zu bezahlen ist, pro Währung und Station (aufklappbar, «Alle aufklappen»), fixe Beträge und Pauschalen getrennt, CHF-Wert jeweils daneben. Alle Beträge – Posten und Pauschalen – stehen in der **Währung vor Ort** des Tages (Standard: Reisewährung, pro Tag oder für einen Bereich über ✎ beim Tag einstellbar, z.B. Reisetage in der Schweiz auf CHF); anders erfasste Posten werden umgerechnet («erfasst: 50 CHF»).
  - **To-dos** – pro Posten (z.B. «Passdaten schicken»), mit Fälligkeit.
  - **Packliste** – aus Vorlagen (unter «Mehr»: Standard, Tauchreise, CCR … – «*» am Zeilenende = pro Person), abhaken pro Person, auch offline; «Alle zurücksetzen» für die Rückreise.
- **Bargeld-Kasse** (unter «Heute» und «Offen → Vor Ort / Bargeld») – Bezüge am Bancomat mit belastetem CHF-Betrag erfassen; bar bezahlte Ausgaben (Bezahlmethode mit Häkchen «Bargeld») ziehen sich ab. Zeigt Bestand im Portemonnaie, effektiven Kurs inkl. Gebühren und wie viel bis Reiseende noch zu beziehen ist. Kassensturz mit Differenz als Ausgabe oder Korrektur.
- **⇄ Umrechnen** (Kopfzeile) – Schnellrechner Lokalwährung ⇄ CHF mit Spickzettel, auch offline; wahlweise zum Bezugskurs.
- **Dokumente** – Pässe, Krankenkasse, Versicherungen, Tauchbrevets … für alle Reisen, nach Kategorie und Person gruppiert, mit Gültigkeitswarnung; offline speicherbar.
- **Auswertung** – nach Kategorie, Kosten pro Tag, Tagesbudget Plan vs. Ist, nach Ort (pro Nacht), Abrechnung nach Bezahlmethode, Kostenaufteilung, Export (CSV, Druck).
- **Mehr** – nur Allgemeines: Bezahlmethoden, Kategorien, Währungen & Kurse, Benutzer, Sicherung.

Keine externen Abhängigkeiten: nur Node.js. Daten als JSON-Datei mit täglicher automatischer Sicherung (30 Tage), Belege als Dateien daneben.

> **Datenschutz:** Im Repo liegt kein einziger persönlicher Wert. Der Ordner `data/` (Reisen, Belege, Sicherungen), Excel- und CSV-Dateien sowie Import-/Sicherungsdateien sind per `.gitignore` ausgeschlossen. Bitte nichts davon manuell einchecken.

---

## Wie Reisli rechnet

| Begriff | Bedeutung |
|---|---|
| **Planbetrag** | Was ein Posten kosten wird – in seiner Währung (z.B. 24'179 THB). Wird laufend zum aktuellen Kurs in CHF gerechnet. |
| **Zahlung** | Was effektiv bezahlt wurde: Datum, Methode und bei Fremdwährung zwei feste Werte – **angerechnet** in der Währung des Postens (laut Buchung, bestimmt den Rest) und **belastet in CHF** (laut Kartenabrechnung, bestimmt die Kosten). Kursschwankungen verschieben den Rest so nicht. Ist nur einer der beiden bekannt, wird der andere einmalig zum Tageskurs geschätzt und eingefroren. Anzahlung und Restzahlung = zwei Zahlungen. |
| **Status** | wird abgeleitet: *offen* → *reserviert* → *angezahlt* → *bezahlt*, jeweils mit «Zahlung vorgängig» oder «vor Ort». |
| **Prognose** | bezahlte Beträge + offene Beträge (zum aktuellen Kurs) + Pauschalen. |
| **Pauschale «Tagesbudget»** | z.B. Essen 80 CHF/Tag. Erfasste Ausgaben der Kategorie werden angerechnet: Prognose = max(Pauschale, Ist); vergangene Tage mit Erfassungen zählen nur noch mit dem Ist. |
| **Pauschale «Platzhalter»** | z.B. Unterkunft 100 CHF/Nacht. Gilt nur, solange für die Nacht keine Unterkunft erfasst ist. |
| **Unterkunft** | ein Posten mit Check-in und Check-out; Kosten werden auf die Nächte verteilt. |

Einzelne Tage können eine Pauschale ausschalten (✎ beim Tag), z.B. Liveaboard mit Vollpension.

**Anzahlung und Restzahlung** gehören in einen Posten: Planbetrag = Total, darunter zwei Zahlungen. Wurden sie als zwei Posten erfasst (z.B. aus der Excel), im Posten **«Mit anderem Posten zusammenführen …»** wählen: Beträge werden addiert (in die Währung des Postens umgerechnet), Zahlungen, To-dos, Belege und Notizen übernommen.

### Kostenaufteilung (nur bei Bedarf)

Unter **✎ Reise bearbeiten → Kostenaufteilung** einschalten und Teilnehmende erfassen. Danach:
- bei jeder Zahlung «bezahlt von»,
- pro Posten die Aufteilung: gleichmässig (alle oder ausgewählte), nach Anteilen (z.B. 2:1) oder nach Beträgen.

Die Auswertung zeigt pro Person «hat bezahlt», «Rückzahlungen», «Anteil», «Saldo» und die **minimalen Ausgleichszahlungen** («Ben → Anna CHF 120.–»). Ist ein Ausgleich bezahlt, mit **«✓ bezahlt»** bestätigen (oder «+ Rückzahlung erfassen»): Die Rückzahlung wird mit Datum, Art und Notiz protokolliert und der Restbestand sofort neu berechnet. Wird die Aufteilung nachträglich eingeschaltet, fragt Reisli, wem bisherige Zahlungen zugeordnet werden sollen.

### Zahlungen nach Kässeli übernehmen

**Offen → Zahlungen → Bisherige Zahlungen → «⬇ CSV für Kässeli …»**: diese oder alle Reisen, alle Methoden oder eine Methode pro Datei (Kässeli ordnet eine Import-Datei einem Zahlungsmittel zu). Spalten: Datum, Buchungstext («Reise: Posten»), Betrag CHF (effektiv belastet), Bezahlmethode, Reise, Posten, Kategorie, Originalbetrag, Währung. Kässeli erkennt das Format automatisch. Zahlungen ohne Datum lassen sich im Export-Fenster direkt nachtragen.

## 1. Lokal starten (Windows)

1. [Node.js](https://nodejs.org) (LTS, ab Version 20) installieren.
2. Repo herunterladen oder klonen.
3. `start.bat` doppelklicken – der Browser öffnet <http://localhost:8081>.
4. Beim ersten Aufruf ein Konto anlegen.

Alternativ im Terminal: `npm start` (Port ändern mit `set PORT=3000`).
Reisli nutzt standardmässig Port **8081**, damit es neben Kässeli (8080) laufen kann.

## 2. Bisherige Ferien-Excel übernehmen

In der App: Reise-Auswahl → **+ Neue Reise … → Aus Excel** → Datei wählen (z.B. `Ferien2027.xlsm`). Du siehst zuerst eine Vorschau mit Abgleich gegen das Excel-Total, Warnungen und erst danach «Reise übernehmen». Die Excel-Datei wird nicht gespeichert.

Was übernommen wird:
- **Übersicht** → Programm, Ort und Notiz pro Tag; Übernachtungen ohne eigene Kosten (Flugzeug, Liveaboard).
- **Reiseablauf** → Posten mit Betrag, Währung, Status, Bezahlmethode, Kommentar; aufeinanderfolgende «Unterkunft»-Zeilen werden zu einer Unterkunft mit Check-in/Check-out. Platzhalter («Aktivität 12») werden ignoriert.
- Status «bezahlt» → Zahlung (Datum unbekannt). «reserviert/angezahlt – vorgängig/vor Ort» → Status + Zahlungsort. Ein Datum im Kommentar («wird am 19.12.26 belastet») wird zum **Fälligkeitsdatum**.
- **Allgemeine Kosteneinstellung** → Pauschalen, nur an den Tagen, an denen sie im Excel standen.
- **Währungsrechner** → Wechselkurse (nur fehlende), **Abrechnung** → Bezahlmethoden und Anzahl Personen.

Unterschied zum Excel: «bereits bezahlt» zählt in Reisli nur echte Zahlungen. Das Excel zählt auch reservierte Posten mit eingetragener Bezahlmethode.

Alternativ per Kommandozeile (erzeugt eine Datei zum Einspielen unter **Mehr → Sicherung → Einspielen**):

```bash
npm run import-excel -- "C:\Pfad\zu\Ferien2027.xlsm"
```

Die erzeugte `reisli-import-*.json` enthält persönliche Daten: nach dem Einspielen löschen.

## 3. Betrieb auf der Synology DS218+

Gleich wie Kässeli – **Container Manager** (DSM 7.2):

1. In der File Station einen Ordner anlegen, z.B. `/docker/reisli`, und den Inhalt dieses Repos hineinkopieren (oder per SSH: `git clone https://github.com/chfelser-hash/reisli.git /volume1/docker/reisli`).
2. Container Manager → **Projekt** → **Erstellen**
   - Projektname: `reisli`
   - Pfad: `/docker/reisli`
   - Quelle: «Vorhandene docker-compose.yml verwenden»
   - Erstellen – das Image wird auf der NAS gebaut und gestartet.
3. Aufruf im Heimnetz: `http://<IP-der-NAS>:8081`, erstes Konto anlegen, dann unter **Mehr → Benutzer** die zweite Person hinzufügen.

Die Daten liegen in `/docker/reisli/data` (Reisen, Belege, tägliche Sicherungen) und werden von Hyper Backup mitgesichert, wenn der Ordner `docker` im Backup-Job ist – empfohlen, denn das schützt auch vor einem Ausfall der NAS.

**Zugriff:** Vorerst nur im Heimnetz oder per VPN. Für späteren Zugriff von unterwegs (HTTPS über Reverse Proxy) siehe Anleitung im Kässeli-README – bei Reisli Port 8081 verwenden und in `docker-compose.yml` `COOKIE_SECURE=true` setzen.

### Update

`git pull` (bzw. neue Version ins Verzeichnis kopieren), dann im Container Manager das Projekt **stoppen → erstellen (Build) → starten**. Die Daten bleiben erhalten.

## 4. Sicherung

- **Automatisch:** Bei der ersten Änderung des Tages wird `data/backups/reisli-JJJJ-MM-TT.json` angelegt, 30 Tage aufbewahrt.
- **Belege** (`data/files/`) werden nicht in jede Sicherung kopiert, sondern genau einmal aufbewahrt – solange der aktuelle Stand oder irgendeine Sicherung noch darauf verweist. Gelöschte Belege kommen mit einer Wiederherstellung also zurück, ohne dass Platz doppelt belegt wird. Einmal täglich räumt der Server Belege ohne Verweis auf. Platzbedarf siehe **Mehr → Sicherung**.
- **Vor dem Löschen einer Reise** wird zusätzlich `vor-loeschen-<Reise>-….json` angelegt.
- **Vor jeder Wiederherstellung** wird der aktuelle Stand zusätzlich gesichert (`vor-wiederherstellung-…`).
- **Mehr → Sicherung:**
  - «Sicherung herunterladen» – alle Reisen und Einstellungen als JSON (klein, z.B. vor der Abreise aufs Handy).
  - «inkl. Belege» – zusätzlich alle hochgeladenen Belege (grösser).
  - «Einspielen» – eine Gesamtsicherung ersetzt alles; eine **Reise-Sicherung** (Auswertung → «Reise als Sicherungsdatei») wird zusätzlich angelegt.
  - «Sicherungen auf dem Server» – jederzeit «Jetzt sichern», frühere Stände laden oder wiederherstellen.

## 5. Wechselkurse

Kurse werden als **CHF pro Einheit** gespeichert (THB 0.025 = 1 CHF ≈ 40 THB). Reisli holt täglich die EZB-Referenzkurse (über [Frankfurter](https://frankfurter.dev), ohne Konto) – zuerst über den Server; kommt der nicht ins Internet (z.B. Firmenlaptop mit Proxy oder Firmenzertifikat), holt der Browser die Kurse beim Öffnen der App bzw. beim Knopf «↻ Kurse holen» selbst. `start.bat` startet Node.js zusätzlich mit den Windows-Zertifikaten (`--use-system-ca`), falls die Node-Version das kann. Währungen, die dort nicht geführt werden, und Kurse mit Häkchen **fix** bleiben unverändert. Ausschalten mit `AUTO_RATES=false` in `docker-compose.yml`.

Bezahlte Beträge sind davon nicht betroffen – sie behalten den effektiv belasteten CHF-Wert.

## 6. Als App installieren

- **Android (Chrome):** Seite öffnen → Menü ⋮ → «Zum Startbildschirm hinzufügen» / «App installieren» (bei Zugriff über `http://` im Heimnetz erscheint nur «Zum Startbildschirm hinzufügen»).
- **Windows (Edge/Chrome):** In der Adressleiste auf das Installieren-Symbol klicken.

## 7. Unterwegs-Modus (offline)

Reisli merkt sich auf jedem Gerät den zuletzt geladenen Stand. Ohne Verbindung zur NAS (Flugzeug, Funkloch, NAS aus)
steht oben **«Offline»** und die App läuft mit diesem Stand weiter:

- **Offline möglich:** Ausgaben erfassen, Zahlungen eintragen, Posten ändern oder löschen, To-dos abhaken, Rückzahlungen.
  Die Änderungen warten auf dem Gerät («3 wartend») und werden automatisch übertragen, sobald die NAS wieder erreichbar ist.
- **Nur online:** Reise, Tage und Pauschalen bearbeiten, Einstellungen, Belege hochladen, Import, Sicherung.
- **Belege:** einmal geöffnete Belege bleiben auf dem Gerät; «Heute → Alle offline speichern» lädt alle Belege der Reise.
- **Beide Handys gleichzeitig:** neue Ausgaben kommen nie in die Quere. Wurde derselbe Posten offline auf dem einen und
  zwischendurch auf dem anderen Gerät geändert, meldet Reisli einen **Konflikt** (oben «⚠ 1 Konflikt»): beide Versionen
  stehen nebeneinander, du wählst, welche gilt.
- Beim **Abmelden** wird die lokale Kopie gelöscht.

Voraussetzung: Zugriff über **HTTPS** – sonst erlaubt der Browser keinen Offline-Speicher. Die einfachste Lösung, die
auch von unterwegs funktioniert, ist Tailscale: **[Anleitung für die DS218+](docs/tailscale.md)**. Über `http://NAS-IP:8081`
im Heimnetz läuft Reisli wie bisher, aber ohne Offline-Modus.

## Technisches

| | |
|---|---|
| Server | `server/` – Node.js ohne Abhängigkeiten, REST-API unter `/api` |
| Oberfläche | `public/` – HTML/CSS/JavaScript-Module, PWA mit Service Worker |
| Rechenlogik | `public/js/calc.js` – wird von Browser, Server (Import) und Tests gemeinsam genutzt |
| Daten | `data/reisli.json`, `data/users.json`, `data/files/` (Belege), `data/backups/` |
| Konfiguration | `PORT` (8081), `DATA_DIR` (./data), `COOKIE_SECURE`, `AUTO_RATES` |
| Offline | `public/sw.js` (Oberfläche + Belege im Cache), `public/js/idb.js` (Datenstand und Warteschlange in IndexedDB) |
| Tests | `npm test` (Rechenlogik), `npm run test:e2e` (API und Browser, braucht Playwright). Auf GitHub laufen alle Tests plus ein Docker-Build automatisch bei jedem Push (Reiter «Actions») |
