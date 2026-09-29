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
import html
import json
import os
import smtplib
import subprocess
import sys
from email.message import EmailMessage

SERVICE_UUID = os.environ.get("CALDIY_SERVICE_UUID", "on6gp9ggl5b33kc1uutzwkkd")
STATE_DIR = "/var/lib/caldiy-hours-watch"
SNAPSHOT = f"{STATE_DIR}/snapshot.json"
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "caldiy-hours-watch-logo.png")
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
    if m == 1440:
        return "midnight"
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


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


def shifts(days):
    """Cal files the part of a late shift after midnight under the next day (Monday 16:00–24:00
    plus Tuesday 00:00–01:00). Join them back into one shift (Monday 16:00–01:00), the way the
    desk hours are written, so the email reads as people think about their hours."""
    out = {d: [list(r) for r in days.get(d, [])] for d in map(str, range(7))}
    for d in range(7):
        today, tomorrow = out[str(d)], out[str((d + 1) % 7)]
        early = next((r for r in tomorrow if r[0] == 0 and r[1] < 1440), None)
        late = next((r for r in today if r[1] == 1440), None)
        if early and late:
            late[1] = 1440 + early[1]
            tomorrow.remove(early)
    return {d: r for d, r in out.items() if r}


def fmt(ranges):
    return ", ".join(f"{hhmm(s)}–{hhmm(e)}" for s, e in ranges) or "no hours"


def total(ranges):
    return sum(e - s for s, e in ranges)


def hours(mins):
    h = mins / 60
    return f"{h:g} hour{'s' if h != 1 else ''}"


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
    """Per advisor: {name, tz, gone, dropped: [(day, before, after, lost)], added: [(day, before, after, gained)]}."""
    changes = []
    for email in sorted(set(old) | set(new)):
        o, n = old.get(email), new.get(email)
        if o is None:
            continue  # new advisor: nothing to compare yet
        name, tz = (n or o)["name"], (n or o)["tz"]
        if n is None:
            changes.append({"name": name, "tz": tz, "gone": True, "dropped": [], "added": []})
            continue
        dropped, added = [], []
        o_days, n_days = shifts(o["days"]), shifts(n["days"])
        for d in DAY_ORDER:
            before, after = o_days.get(str(d), []), n_days.get(str(d), [])
            lost, gained = subtract(before, after), subtract(after, before)
            if lost:
                dropped.append((DAYS[d], before, after, total(lost)))
            elif gained:
                added.append((DAYS[d], before, after, total(gained)))
        if dropped or added:
            changes.append({"name": name, "tz": tz, "gone": False, "dropped": dropped, "added": added})
    return changes


RED, BLUE, INK, BODY, MUTED, RULE, SOFT, SOFTBLUE, SOFTRED = (
    "#DC1C2E", "#003DA5", "#16181d", "#2b2f38", "#646c7a", "#dfe3ea", "#f5f7fa", "#eef3fb", "#fdeef0")
FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif"
FOOTNOTE = ("New bookings already follow the new hours; calls booked before the change stay booked. "
            "Calls are only ever offered between 8am and 8.30pm UK time, whatever the hours say.")


def build_email(changes):
    reduced = [c for c in changes if c["gone"] or c["dropped"]]
    if not reduced:
        return None
    names = ", ".join(c["name"] for c in reduced)
    subject = f"UK call hours reduced: {names}"
    return subject, build_text(changes, reduced), build_html(changes, reduced)


def build_text(changes, reduced):
    lines = ["UK call hours were reduced in the booking system (book.remaxhub.ae) since yesterday.", ""]
    for c in reduced:
        if c["gone"]:
            lines += [f"{c['name']}: no longer has a schedule in the booking system.", ""]
            continue
        lost = sum(x[3] for x in c["dropped"])
        lines.append(f"{c['name']}: {hours(lost)} fewer a week (times in Dubai):")
        lines += [f"  {day}: was {fmt(b)}, now {fmt(a)}" for day, b, a, _ in c["dropped"]]
        lines += [f"  For info, {day}: was {fmt(b)}, now {fmt(a)}" for day, b, a, _ in c["added"]]
        lines.append("")
    others = [c for c in changes if not c["gone"] and not c["dropped"] and c["added"]]
    if others:
        lines.append("For info, hours were added for:")
        for c in others:
            lines += [f"  {c['name']}, {day}: was {fmt(b)}, now {fmt(a)}" for day, b, a, _ in c["added"]]
        lines.append("")
    return "\n".join(lines + [FOOTNOTE]) + "\n"


def hfmt(ranges):
    """fmt() for HTML: a time range never breaks across lines."""
    return ", ".join(f"<span style=\"white-space:nowrap\">{hhmm(s)}–{hhmm(e)}</span>" for s, e in ranges) or "no hours"


def _table(items, accent, sign, head):
    """Two columns so it fits a phone: the day and the change, then was and now stacked."""
    th = f"padding:8px 12px;background:{head};color:#ffffff;font:600 12px/1.3 {FONT};letter-spacing:.04em;text-align:left"
    rows = []
    for i, (day, before, after, mins) in enumerate(items):
        td = f"padding:10px 12px;border-bottom:1px solid {RULE};vertical-align:top;background:{SOFT if i % 2 else '#ffffff'}"
        rows.append(
            f"<tr><td width=\"30%\" style=\"{td}\"><div style=\"font:700 14px/1.4 {FONT};color:{INK}\">{day}</div>"
            f"<div style=\"font:700 13px/1.4 {FONT};color:{accent};white-space:nowrap\">{sign}{hours(mins)}</div></td>"
            f"<td style=\"{td}\"><div style=\"font:13px/1.45 {FONT};color:{MUTED}\">Was {hfmt(before)}</div>"
            f"<div style=\"font:600 14px/1.45 {FONT};color:{INK}\">Now {hfmt(after)}</div></td></tr>")
    return (f"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;margin:0 0 6px\">"
            f"<tr><th style=\"{th}\">Day</th><th style=\"{th}\">Hours (Dubai time)</th></tr>{''.join(rows)}</table>")


def build_html(changes, reduced):
    e = html.escape
    p = f"margin:0 0 14px;font:15px/1.5 {FONT};color:{BODY}"
    blocks = []
    for c in reduced:
        if c["gone"]:
            blocks.append(
                f"<h2 style=\"margin:26px 0 6px;font:700 17px/1.3 {FONT};color:{INK}\">{e(c['name'])}</h2>"
                f"<p style=\"{p}\">No longer has a schedule in the booking system, so no calls can be booked with them.</p>")
            continue
        lost = sum(x[3] for x in c["dropped"])
        blocks.append(
            f"<h2 style=\"margin:26px 0 8px;font:700 17px/1.3 {FONT};color:{INK}\">{e(c['name'])}"
            f"<span style=\"display:inline-block;margin-left:10px;padding:3px 9px;border-radius:999px;background:{SOFTRED};"
            f"color:{RED};font:700 12px/1.4 {FONT};vertical-align:2px\">{hours(lost)} fewer a week</span></h2>"
            + _table(c["dropped"], RED, "−", BLUE)
            + (f"<p style=\"margin:10px 0 4px;font:600 12px/1.4 {FONT};color:{MUTED};letter-spacing:.06em;text-transform:uppercase\">Also added</p>"
               + _table(c["added"], BLUE, "+", "#6b7a92") if c["added"] else ""))
    others = [c for c in changes if not c["gone"] and not c["dropped"] and c["added"]]
    info = ""
    if others:
        items = "".join(
            f"<li style=\"margin:0 0 4px\"><b style=\"color:{INK}\">{e(c['name'])}</b>, {day}: {hfmt(b)} → {hfmt(a)}</li>"
            for c in others for day, b, a, _ in c["added"])
        info = (f"<div style=\"margin:22px 0 0;padding:12px 16px;background:{SOFT};border-left:5px solid #c8cedb;border-radius:0 6px 6px 0\">"
                f"<div style=\"font:700 14px/1.4 {FONT};color:{INK};margin:0 0 4px\">For info: hours added</div>"
                f"<ul style=\"margin:0;padding-left:18px;font:14px/1.5 {FONT};color:{BODY}\">{items}</ul></div>")
    who = len(reduced)
    lede = f"{who} advisor{'s have' if who != 1 else ' has'} fewer UK call hours than yesterday. Times are Dubai time."
    logo = ("<img src=\"cid:logo\" width=\"140\" alt=\"REMAX Hub\" style=\"display:block;width:140px;height:auto;border:0\">"
            if os.path.exists(LOGO) else f"<span style=\"font:800 20px {FONT};color:{INK}\">REMAX Hub</span>")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:{SOFT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{SOFT}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid {RULE}">
<tr><td style="padding:0;line-height:0;font-size:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="38%" style="height:6px;background:{RED}"></td><td style="height:6px;background:{BLUE}"></td></tr></table></td></tr>
<tr><td style="padding:22px 28px 14px;border-bottom:1px solid {RULE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td>{logo}</td><td align="right" style="font:600 11px/1.3 {FONT};color:{MUTED};letter-spacing:.1em;text-transform:uppercase">Booking system<br>daily check</td></tr></table></td></tr>
<tr><td style="padding:24px 28px 8px">
<div style="font:700 12px/1.3 {FONT};color:{RED};letter-spacing:.14em;text-transform:uppercase;margin:0 0 8px">UK call desk · hours</div>
<h1 style="margin:0 0 10px;font:700 26px/1.2 {FONT};color:{INK}">Call hours reduced</h1>
<p style="{p}">{lede}</p>
{"".join(blocks)}{info}
<div style="margin:24px 0 8px;padding:12px 16px;background:{SOFTBLUE};border-left:5px solid {BLUE};border-radius:0 6px 6px 0">
<div style="font:700 14px/1.4 {FONT};color:{BLUE};margin:0 0 4px">What this means</div>
<div style="font:14px/1.5 {FONT};color:{BODY}">{FOOTNOTE}</div></div>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid {RULE};font:12px/1.5 {FONT};color:{MUTED}">
Sent by REMAX Hub's booking system (book.remaxhub.ae) at 9am Dubai time, only on days when someone's hours drop.</td></tr>
</table></td></tr></table></body></html>"""


def send(subject, body, html_body, to):
    smtp = load_env("/opt/blog-watch/config.env")
    msg = EmailMessage()
    msg["From"] = f"REMAX Hub <{smtp['EMAIL_SMTP_USER']}>"
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    msg.add_alternative(html_body, subtype="html")
    if os.path.exists(LOGO):
        msg.get_payload()[1].add_related(open(LOGO, "rb").read(), "image", "png", cid="<logo>",
                                         filename="remax-hub.png", disposition="inline")
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
        open("/tmp/caldiy-hours-watch-preview.html", "w").write(mail[2].replace("cid:logo", LOGO))
        print("HTML preview: /tmp/caldiy-hours-watch-preview.html")
    elif mail:
        if not to:
            sys.exit("HOURS_WATCH_TO is not set in /etc/caldiy-hours-watch.env")
        send(mail[0], mail[1], mail[2], to)
        print("sent:", mail[0])
    else:
        print("no reductions")
    if not dry_run:
        json.dump(new, open(SNAPSHOT, "w"), indent=1)


if __name__ == "__main__":
    main()
