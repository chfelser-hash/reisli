# Reisli von unterwegs: Tailscale auf der DS218+

Mit Tailscale sind die Handys auch im Ausland direkt mit der NAS verbunden – ohne Port im Router zu öffnen.
`tailscale serve` liefert Reisli zusätzlich über **HTTPS** mit gültigem Zertifikat aus. Das braucht der
Unterwegs-Modus: Nur über HTTPS darf der Browser die App und die Belege offline speichern.

Kosten: Der «Personal»-Plan ist gratis (bis 6 Personen, beliebig viele Geräte, privat).

## 1. Konto anlegen

1. <https://login.tailscale.com> → mit Google-, Microsoft- oder Apple-Konto anmelden.
2. In der Admin-Konsole unter **DNS**: **MagicDNS** einschalten und weiter unten **HTTPS Certificates → Enable HTTPS**.
   Die NAS bekommt später eine Adresse wie `ds218.tail1234.ts.net`.

## 2. Tailscale auf der NAS installieren

Die Version im Paket-Zentrum ist veraltet – die aktuelle direkt von Tailscale nehmen:

1. <https://pkgs.tailscale.com/stable/#spks> → **DSM 7**, Architektur der DS218+: **x86_64** → `.spk` herunterladen.
2. DSM → **Paket-Zentrum → Manuelle Installation** → Datei wählen → installieren (Warnung «Drittanbieter» bestätigen).
3. Paket öffnen → **Log in** → mit demselben Konto anmelden. Die NAS erscheint in der Admin-Konsole unter **Machines**.
4. Dort beim Gerät `…` → **Disable key expiry** (sonst muss sich die NAS alle 180 Tage neu anmelden).

### Damit die NAS auch selbst Verbindungen aufbauen kann (DSM 7)

DSM → **Systemsteuerung → Aufgabenplaner → Erstellen → Ausgelöste Aufgabe → Benutzerdefiniertes Skript**
- Allgemein: Name `Tailscale TUN`, Benutzer **root**, Ereignis **Hochfahren**
- Aufgabeneinstellungen → Skript:
  ```sh
  /var/packages/Tailscale/target/bin/tailscale configure-host; synosystemctl restart pkgctl-Tailscale.service
  ```
Speichern, Aufgabe einmal markieren → **Ausführen**.

### Automatische Updates (optional)

Aufgabenplaner → **Geplante Aufgabe → Benutzerdefiniertes Skript**, Benutzer **root**, z.B. wöchentlich:
```sh
/var/packages/Tailscale/target/bin/tailscale update --yes
```

## 3. Reisli über HTTPS freigeben

Per SSH auf die NAS (DSM → Systemsteuerung → Terminal & SNMP → SSH aktivieren), dann:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8081
```

- Erscheint ein Link, um HTTPS zu aktivieren: öffnen, bestätigen, Befehl nochmals ausführen.
- `--bg` bleibt auch nach einem Neustart aktiv.
- Reisli ist jetzt erreichbar unter **`https://ds218.tail1234.ts.net`** (genauer Name: `tailscale status` bzw. Admin-Konsole).
- Nur für Geräte im eigenen Tailnet sichtbar – nicht öffentlich im Internet.

Kässeli zusätzlich (anderer HTTPS-Port):
```sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8080
```
→ `https://ds218.tail1234.ts.net:8443`

Kontrolle und Ausschalten:
```sh
sudo tailscale serve status
sudo tailscale serve --https=443 off     # einzelne Freigabe entfernen
sudo tailscale serve reset               # alles entfernen
```

> Reisli braucht dafür nichts Spezielles: `COOKIE_SECURE` kann auf `false` bleiben, damit die Anmeldung
> im Heimnetz über `http://NAS-IP:8081` weiterhin funktioniert.

## 4. Handys einrichten

1. App **Tailscale** aus dem Play Store / App Store installieren, mit demselben Konto anmelden, verbinden.
2. In Chrome `https://ds218.tail1234.ts.net` öffnen → anmelden → Menü ⋮ → **App installieren**.
   (Die bisher über `http://192.168…` installierte App deinstallieren – sie kann nicht offline arbeiten.)
3. Für die Frau: entweder dasselbe Tailscale-Konto, oder in der Admin-Konsole unter **Users → Invite** einladen.

Tailscale darf auf dem Handy dauernd eingeschaltet bleiben: Nur Verkehr zur NAS geht durch den Tunnel, der Rest
normal ins Internet.

## 5. Optional: Wie mit OpenVPN «von zu Hause aus» surfen (Exit Node)

Auf der NAS:
```sh
sudo tailscale set --advertise-exit-node
```
Admin-Konsole → Machines → NAS → `…` → **Edit route settings** → **Use as exit node** anhaken.

Auf dem Handy in der Tailscale-App → **Exit Node** → NAS wählen. Jetzt läuft aller Verkehr über den Anschluss zu
Hause (z.B. für Schweizer Streaming oder E-Banking aus dem Ausland). Ausschalten: Exit Node «None».

## 6. Vor der Abreise

- In Reisli unter **Heute → Belege & Tickets → Alle offline speichern** tippen (auf beiden Handys).
- Einmal im Flugmodus prüfen: App öffnen → «Offline» oben, Belege lassen sich öffnen.
