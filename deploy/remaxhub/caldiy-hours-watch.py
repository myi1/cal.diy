#!/usr/bin/env python3
"""Daily check of the desk advisors' weekly call hours in Cal.diy (book.remaxhub.ae).

Reads each advisor's default schedule (role USER) from the calcom database, compares it with
yesterday's snapshot, and emails when anyone's weekly hours drop (additions are listed "for info").
One-off date overrides are ignored: this is about weekly hours.

Installed at /usr/local/bin/caldiy-hours-watch.py, run by /etc/cron.d/caldiy.
Config: /etc/caldiy-hours-watch.env (HOURS_WATCH_TO, space-separated recipients).
SMTP comes from /opt/blog-watch/config.env (hub@remax.ae), as for the backup alerts.
State: /var/lib/caldiy-hours-watch/snapshot.json. First run only saves a baseline.
  --dry-run   print the email instead of sending it (snapshot not updated)
"""
import json
import os
import smtplib
import subprocess
import sys
from email.message import EmailMessage

SERVICE_UUID = os.environ.get("CALDIY_SERVICE_UUID", "on6gp9ggl5b33kc1uutzwkkd")
STATE_DIR = "/var/lib/caldiy-hours-watch"
SNAPSHOT = f"{STATE_DIR}/snapshot.json"
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]  # show Monday first

SQL = """
select coalesce(json_agg(row_to_json(t)), '[]') from (
  select u.email, u.name, s."timeZone" as tz, a.days,
         to_char(a."startTime", 'HH24:MI') as start, to_char(a."endTime", 'HH24:MI') as "end"
  from users u
  join "Schedule" s on s.id = u."defaultScheduleId"
  join "Availability" a on a."scheduleId" = s.id
  where u.role = 'USER' and not u.locked and a.date is null
) t
"""


def load_env(path):
    env = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hhmm(m):
    return "24:00" if m >= 1440 else f"{m // 60:02d}:{m % 60:02d}"


def merge(ranges):
    out = []
    for s, e in sorted(ranges):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def subtract(a, b):
    """Parts of ranges a not covered by ranges b."""
    result = []
    for s, e in a:
        pieces = [[s, e]]
        for bs, be in b:
            nxt = []
            for ps, pe in pieces:
                if be <= ps or bs >= pe:
                    nxt.append([ps, pe])
                    continue
                if ps < bs:
                    nxt.append([ps, bs])
                if be < pe:
                    nxt.append([be, pe])
            pieces = nxt
        result.extend(p for p in pieces if p[1] > p[0])
    return result


def fmt(ranges):
    return ", ".join(f"{hhmm(s)}–{hhmm(e)}" for s, e in ranges) or "no hours"


def current_hours():
    out = subprocess.run(
        ["docker", "exec", f"postgres-{SERVICE_UUID}", "psql", "-U", "calcom", "-d", "calcom", "-tAc", SQL],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    advisors = {}
    for row in json.loads(out or "[]"):
        adv = advisors.setdefault(row["email"], {"name": row["name"], "tz": row["tz"], "days": {}})
        end = row["end"]
        # Cal stores "until midnight" as 23:59; treat it as the end of the day.
        end_min = 1440 if end == "23:59" else minutes(end)
        for d in row["days"]:
            adv["days"].setdefault(str(d), []).append([minutes(row["start"]), end_min])
    for adv in advisors.values():
        adv["days"] = {d: merge(r) for d, r in adv["days"].items()}
    return advisors


def diff(old, new):
    """Per advisor: (name, tz, [lines about reductions], [lines about additions])."""
    changes = []
    for email in sorted(set(old) | set(new)):
        o, n = old.get(email), new.get(email)
        if o is None:
            continue  # new advisor: nothing to compare yet
        name = (n or o)["name"]
        tz = (n or o)["tz"]
        if n is None:
            changes.append((name, tz, ["No longer has a schedule in the booking system."], []))
            continue
        dropped, added = [], []
        for d in DAY_ORDER:
            before, after = o["days"].get(str(d), []), n["days"].get(str(d), [])
            if subtract(before, after):
                dropped.append(f"  {DAYS[d]}: was {fmt(before)}, now {fmt(after)}")
            elif subtract(after, before):
                added.append(f"  {DAYS[d]}: was {fmt(before)}, now {fmt(after)}")
        if dropped or added:
            changes.append((name, tz, dropped, added))
    return changes


def build_email(changes):
    reduced = [c for c in changes if c[2]]
    if not reduced:
        return None
    names = ", ".join(c[0] for c in reduced)
    lines = ["UK call hours were reduced in the booking system (book.remaxhub.ae) since yesterday.", ""]
    for name, tz, dropped, added in reduced:
        lines.append(f"{name} (times in {tz}):")
        lines.extend(dropped)
        if added:
            lines.append("  For info, also added:")
            lines.extend("  " + a for a in added)
        lines.append("")
    others = [c for c in changes if not c[2] and c[3]]
    if others:
        lines.append("For info, hours were added for:")
        for name, tz, _, added in others:
            lines.append(f"{name} (times in {tz}):")
            lines.extend(added)
        lines.append("")
    lines += [
        "New bookings already follow the new hours; calls booked before the change stay booked.",
        "Every call also stays inside 8:00am-8:45pm UK time, whatever the hours say.",
    ]
    return f"UK call hours reduced: {names}", "\n".join(lines) + "\n"


def send(subject, body, to):
    smtp = load_env("/opt/blog-watch/config.env")
    msg = EmailMessage()
    msg["From"] = f"REMAX Hub <{smtp['EMAIL_SMTP_USER']}>"
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL(smtp["EMAIL_SMTP_HOST"], int(smtp.get("EMAIL_SMTP_PORT", "465")), timeout=30) as s:
        s.login(smtp["EMAIL_SMTP_USER"], smtp["EMAIL_SMTP_PASSWORD"])
        s.send_message(msg)


def main():
    dry_run = "--dry-run" in sys.argv
    to = load_env("/etc/caldiy-hours-watch.env").get("HOURS_WATCH_TO", "").split()
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    new = current_hours()
    if not os.path.exists(SNAPSHOT):
        if not dry_run:
            json.dump(new, open(SNAPSHOT, "w"), indent=1)
        print(f"baseline saved for {len(new)} advisors")
        return
    old = json.load(open(SNAPSHOT))
    mail = build_email(diff(old, new))
    if mail and dry_run:
        print("To:", " ".join(to) or "(none)")
        print("Subject:", mail[0])
        print(mail[1])
    elif mail:
        if not to:
            sys.exit("HOURS_WATCH_TO is not set in /etc/caldiy-hours-watch.env")
        send(mail[0], mail[1], to)
        print("sent:", mail[0])
    else:
        print("no reductions")
    if not dry_run:
        json.dump(new, open(SNAPSHOT, "w"), indent=1)


if __name__ == "__main__":
    main()
