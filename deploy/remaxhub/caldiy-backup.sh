#!/bin/bash
# Nightly backup of the booking database (Cal.diy on Coolify, book.remaxhub.ae).
# Installed at /usr/local/bin/caldiy-backup.sh, run by /etc/cron.d/caldiy.
#
# pg_dump (custom format) of the calcom database, checked with pg_restore --list.
# Here: /var/backups/caldiy, 14 days. Off-site: B2, 60 days.
# The dump holds the advisors' Zoho tokens, encrypted with CALENDSO_ENCRYPTION_KEY; that key is kept
# in Coolify env and ~/dev/secrets.env on Yahya's Mac, never next to the dumps.
# A failure emails ALERT_EMAIL through the SMTP settings in /opt/blog-watch/config.env (same as cms-backup.sh).
set -euo pipefail

SERVICE_UUID="${CALDIY_SERVICE_UUID:?set CALDIY_SERVICE_UUID in /etc/cron.d/caldiy}"
PG="postgres-${SERVICE_UUID}"
DIR=/var/backups/caldiy
LOG=/var/log/caldiy-backup.log
REMOTE=b2:remaxhub-outline-backups/caldiy
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$DIR/caldiy-$TS.dump"
TMP="$OUT.part"
STEP="starting"

alert_email() {
  # shellcheck disable=SC1091
  [ -r /opt/blog-watch/config.env ] && . /opt/blog-watch/config.env
  [ -n "${ALERT_EMAIL:-}" ] && [ -n "${EMAIL_SMTP_HOST:-}" ] && [ -n "${EMAIL_SMTP_USER:-}" ] || return 0
  local rcpt
  for rcpt in $ALERT_EMAIL; do
    {
      printf 'From: RE/MAX Hub Monitoring <%s>\r\n' "$EMAIL_SMTP_USER"
      printf 'To: %s\r\n' "$rcpt"
      printf 'Subject: %s\r\n' "$1"
      printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
      printf '%s\r\n' "$2"
    } | curl -sS --max-time 30 --ssl-reqd \
          --url "smtps://${EMAIL_SMTP_HOST}:${EMAIL_SMTP_PORT:-465}" \
          --user "${EMAIL_SMTP_USER}:${EMAIL_SMTP_PASSWORD}" \
          --mail-from "$EMAIL_SMTP_USER" --mail-rcpt "$rcpt" \
          --upload-file - >/dev/null 2>&1 || true
  done
}

fail() {
  echo "$(date -u +%FT%TZ) FAIL while $STEP" >> "$LOG"
  rm -f "$TMP"
  alert_email "[FAILED] Booking database backup" "The nightly backup of the booking database (book.remaxhub.ae) failed while $STEP, at $(date -u '+%F %T') UTC.

Bookings keep working. Last lines of $LOG on the server:

$(tail -5 "$LOG")"
}
trap fail ERR

if [ "${1:-}" = "--test-alert" ]; then
  alert_email "[TEST] Booking database backup alerts work" "This is a test of the failure alert for the nightly booking database backup. Nothing is wrong."
  exit 0
fi

mkdir -p "$DIR"
chmod 700 "$DIR"

STEP="dumping the database"
docker exec "$PG" pg_dump -U calcom -d calcom -Fc > "$TMP"

STEP="checking the dump"
tables=$(docker exec -i "$PG" pg_restore --list < "$TMP" | grep -c ' TABLE DATA ' || true)
[ "$tables" -gt 50 ] || { echo "only $tables tables in dump" >> "$LOG"; false; }
mv "$TMP" "$OUT"
chmod 600 "$OUT"
find "$DIR" -name 'caldiy-*.dump' -mtime +14 -delete

STEP="uploading the dump"
rclone copyto "$OUT" "$REMOTE/db/caldiy-$TS.dump"
STEP="pruning old off-site copies"
rclone delete "$REMOTE/db" --min-age 60d

echo "$(date -u +%FT%TZ) OK $(( $(stat -c %s "$OUT") / 1024 ))KB, $tables tables" >> "$LOG"
