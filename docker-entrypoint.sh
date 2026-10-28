#!/bin/sh
# Datenordner dem App-Benutzer geben (vermeidet Rechteprobleme auf der Synology)
# und den Server danach ohne Root-Rechte starten.
set -e
chown -R node:node /data
exec su-exec node "$@"
