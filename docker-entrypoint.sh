#!/bin/sh
# Datenordner dem App-Benutzer geben (vermeidet Rechteprobleme auf der Synology)
# und den Server danach ohne Root-Rechte starten.
set -e
chown -R node:node /data
# Programmordner als Git-Klon eingebunden (Aktualisieren über die App): dem App-Benutzer geben
if [ -d /app/.git ]; then chown -R node:node /app; fi
exec su-exec node "$@"
