#!/bin/bash
# Test of the managed-ids selection in caldiy-build.sh (no docker, no git): extracts the selection lines and
# runs them. Usage: deploy/remaxhub/builder/caldiy-build.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SNIPPET=$(sed -n '/^MANAGED_FILE=/,/^MANAGED_IDS=/p' "$HERE/caldiy-build.sh")
[ -n "$SNIPPET" ] || { echo "FAIL could not extract the selection lines"; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail=0
pick() { # last-file-content ("" = no file) -> prints MANAGED_IDS; HUB_MANAGED_SCHEDULE_IDS comes from the caller
  rm -f "$TMP/last"; [ "$1" = NOFILE ] || printf '%s\n' "$1" > "$TMP/last"
  MANAGED_FILE="$TMP/last" bash -c "$SNIPPET"'; printf "%s" "$MANAGED_IDS"'
}
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi
}
unset HUB_MANAGED_SCHEDULE_IDS
check "unset keeps the last list" "$(pick 3,14)" "3,14"
check "unset with no file is empty" "$(pick NOFILE)" ""
check "explicit empty turns it off" "$(HUB_MANAGED_SCHEDULE_IDS="" pick 3,14)" ""
check "explicit list replaces the last one" "$(HUB_MANAGED_SCHEDULE_IDS=5 pick 3,14)" "5"
exit $fail
