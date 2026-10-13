# book.remaxhub.ae runbook (Cal.diy for UK video calls)

REMAX Hub's booking layer: a self-hosted Cal.diy fork. Leads never use Cal's own pages; Hub Admin books through API v2 and receives webhooks. Video (Daily.co) and host selection live in Hub Admin.

## Map

| Thing | Where |
|---|---|
| Web (booking pages, advisor login, admin) | https://book.remaxhub.ae, container `web-<uuid>` |
| API v2 | https://book-api.remaxhub.ae/v2/..., container `api-<uuid>` |
| Coolify | project "UK Booking (Cal.diy)" `xygswbjo9twx6asdk9zflvfu`, service `caldiy` `on6gp9ggl5b33kc1uutzwkkd` |
| Database | `postgres-<uuid>` (Postgres 16, db and user `calcom`), volume `caldiy-postgres` |
| Code | github.com/myi1/cal.diy, branch `remaxhub` (default). `upstream` = calcom/cal.diy |
| Images | `ghcr.io/myi1/caldiy-web` and `caldiy-api`, tag `sha-<10 chars>`, built by `.github/workflows/remaxhub-images.yml` |
| Secrets | Coolify env on the service only; a copy of each in `~/dev/secrets.env` on Yahya's Mac (`caldiy_*`) |
| Cron | `/etc/cron.d/caldiy` (webhook triggers every minute, backup 23:30 UTC) |
| Backups | `/usr/local/bin/caldiy-backup.sh` → `/var/backups/caldiy` (14 days) + `b2:remaxhub-outline-backups/caldiy/db` (60 days) |

`CALENDSO_ENCRYPTION_KEY` encrypts the advisors' Zoho tokens. A backup is useless without it, and changing it means every advisor reconnects Zoho.

## Our patches on top of upstream

1. Zoho Calendar: `notify_attendee: 0` on create/update/delete (no Zoho invite on top of Cal's email, cal.com#29592), and fail closed: if Zoho can't be read, the whole range is busy and `zoho_freebusy_failed user=<email> err=…` is logged.
2. Security: webhook `teamId` planting (CVE-2026-16624), ownerless-webhook edit/delete, permission stubs deny instead of allow, `SameSite=lax` cookies and no OAuth-state exemptions (CVE-2026-9303).
3. Next.js 16.3.7, next-auth 4.24.15, Node 22 images.
4. Build args for signup-off and REMAX Hub branding (`NEXT_PUBLIC_*` are baked in at build time).
5. `REMAXHUB_ENABLED_APPS` (seed-app-store keeps only these apps enabled; cron guard as backup).
6. Restriction schedules apply to slots (upstream hard-disabled them), and slot filtering is DST-safe (epoch-ms comparisons; UTC date stepping).
7. `REMAXHUB_ORGANIZER_ICS=off`: emails to the host carry no .ics. Zoho Mail imported it, duplicating the Zoho event and leaving stale copies after reschedules and cancellations.
8. Emails: REMAX Hub branding and UK English; no emails to `@no-email.remaxhub.ae` leads; silent handover (`[handover]` cancellation reason, `hub_handover` booking metadata); per-side titles (`{HOST/ATTENDEE}` resolved for each recipient in `packages/emails/lib/attendeeTitle.ts`).
9. Confirmation emails still go out when every calendar write fails, if the location is a URL (upstream sent none, so a Zoho blip left the buyer without a confirmation).
10. API v2 logs never carry credentials or personal data: the `Authorization` header is logged as `Bearer [REDACTED]`, and request/response/error bodies only as their top-level keys and size (`apps/api/v2/src/lib/filterReqHeaders.ts`). Before 30 Sep the hub-bot key and full booking bodies were in the API container logs.

## Deploy a new image

1. Push to `remaxhub`, then build on the Windows builder: `ssh win "wsl -d caldiy-builder -u root -- /root/caldiy-build.sh"` (~5 min; only changed images are rebuilt, `FORCE=1` rebuilds both). Tag = `sha-<first 10 chars of the commit>`. Test a branch first with `NO_PUSH=1 … origin/<branch>` and `/root/caldiy-smoke.sh <tag>`. The GitHub workflow is a manual fallback (Actions → REMAX Hub images → Run workflow, ~22 min).
2. Back up: `ssh root@100.108.208.27 'CALDIY_SERVICE_UUID=on6gp9ggl5b33kc1uutzwkkd /usr/local/bin/caldiy-backup.sh'`.
3. Record the tag in Coolify's database so its config stays true: `PATCH /services/<uuid>/envs {"key":"IMAGE_TAG","value":"<tag>"}`. If the compose changed, also `PATCH /services/<uuid>` with `docker_compose_raw` (base64, YAML anchors exploded with `yq --yaml-fix-merge-anchor-to-spec=true 'explode(.) | del(."x-cal-common")'`) **and** `urls` (web `https://book.remaxhub.ae:3000`, api `https://book-api.remaxhub.ae:80`).
4. **Do not use Coolify's Restart/Deploy for a new image.** It deletes every image not in use at that moment, including ones you just pre-pulled, and then removes the containers without starting them (30 Sep: 28 min of pre-pull thrown away and ~35 min down). Instead, on the box:
   ```sh
   S=on6gp9ggl5b33kc1uutzwkkd; D=/data/coolify/services/$S
   sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=<tag>/" $D/.env          # same value as in Coolify's DB
   cd $D && docker compose -p $S pull web api                 # site stays up while this runs
   docker compose -p $S up -d --no-deps web api               # swaps only web + api (~40 s); --no-deps keeps Postgres/Redis running
   ```
   If the compose itself changed, apply it through Coolify once (step 3) and copy Coolify's generated `docker-compose.yml` only when the new images are already running, or accept the Coolify path's downtime.
5. Run long pulls detached (`setsid nohup … &`); an SSH timeout or `pkill -f` whose pattern matches your own command line will kill them.
6. Check: both containers on the new tag, web healthy, `select count(*) from users` is unchanged, only `zohocalendar` is enabled in `"App"`, and a slots request answers.

Rollback: set `IMAGE_TAG` back to the previous tag and repeat 3–6. Restore the dump only if the new version ran a database migration that the old one can't read.

## Hub-owned hours

For advisors whose working hours the Hub writes, the Cal.diy availability pages show the hours read-only: "Hours are set in the Hub. Change your shifts and blocks in Settings → You → Schedule." The Hub keeps writing through the advisor's key on API v2, which is not changed.

- **Turn it on:** set `NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS` to a comma-separated list of schedule ids, e.g. `3,14,20`. List only verified advisors' **default** schedule ids. Never list restriction schedules 7-12 (the code refuses them even if listed). Default is empty: nothing is managed and every page behaves as upstream.
- **It is a build-time variable** (`NEXT_PUBLIC_*` is baked into the bundles), so changing it needs a rebuild of the web image, not a restart or a Coolify env change (Coolify's env does nothing for it). It is a `ARG`/`ENV` in the `Dockerfile` and is passed by both build paths, empty by default:
  - Windows builder: `ssh win "wsl -d caldiy-builder -u root -- env HUB_MANAGED_SCHEDULE_IDS=3,14,20 /root/caldiy-build.sh <sha> web"`. The script remembers the last ids in `/root/caldiy-last-managed-ids` and rebuilds web when they change, even if no file did.
  - GitHub fallback: set the repository variable `HUB_MANAGED_SCHEDULE_IDS` (Settings → Secrets and variables → Actions → Variables) before running "REMAX Hub images".
  Then follow "Deploy a new image".
- **Keeping and clearing the list:** a build that does not mention `HUB_MANAGED_SCHEDULE_IDS` keeps the last pushed list (the script logs the ids it uses on every build). To turn the feature off, pass it explicitly empty: `env HUB_MANAGED_SCHEDULE_IDS= /root/caldiy-build.sh <sha> web`. The selection is tested by `deploy/remaxhub/builder/caldiy-build.test.sh`. The GitHub fallback has no memory: it uses the repository variable and nothing else.
- **Never set `NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS` in Coolify's env, for either container.** It is read at build time only; a runtime value does nothing for the web UI and must not be put on the api container (the Hub's API v2 writes must never see a guard).
- **Check the build before deploying** (a build that manages nothing looks identical on the surface). Build with `NO_PUSH=1` first, then confirm the ids string is inlined in the built bundles; an empty result means the ids did not reach the build. The ids and the "Hours are set in the Hub" text can land in different chunks, and the minifier may fold the split list, so search for the ids string alone:
  ```sh
  docker run --rm --entrypoint sh ghcr.io/myi1/caldiy-web:<tag> -c \
    'grep -rlF "3,14,20" /calcom/apps/web/.next/static /calcom/apps/web/.next/server'
  ```
  Use the exact ids string you built with. This only shows the ids were baked in; the real proof is after deploying: open `/availability` as a listed advisor and confirm the banner and read-only page.
- **Roll back:** build again with the variable empty (or set `IMAGE_TAG` back to the previous tag) and repeat "Deploy a new image". Advisors' schedules and the API are untouched either way.
- **What is blocked for a managed schedule:** the web editor and the "Set as default" menu item (hidden); the tRPC schedule update (refused with 403 "Hours are set in the Hub.", which also covers onboarding's setup-availability step, where the page shows the hours instead); making another schedule the default while a managed one is the default; the Settings → General time-zone change and the travel-schedule cron no longer rewrite a managed default schedule's `timeZone` (the Hub sets it, Asia/Dubai after import approval).
- **Known gaps:** (1) An advisor can still point an event type's availability tab at a different, unmanaged schedule; guarding that means changing the event-type update path and its UI, which is invasive, so it is left as is (the Hub's routing does not depend on event-type schedules; revisit if advisors do it). (2) The managed-ids check is per build, so a schedule deleted and recreated gets a new id and must be re-listed. (3) The UI is not API authorisation: a leaked advisor API key can still change that advisor's schedule through API v2, which is what the Hub itself uses.
- **Display notes:** times are in the schedule's own zone (or the user's zone when the schedule has none). A day ending at midnight is stored as `23:59` (Cal rejects `24:00`) and is shown as `24:00`; a `00:00-00:00` date override is shown as "Unavailable all day".
- **Deploying needs Yahya's yes**, with a backup first and the image tag recorded. This is UI only; it does not make Cal follow Hub blocks, so `routing.cal.enabled` still waits for each advisor key's own proof.

## Upgrading from upstream

```bash
cd ~/dev/cal.diy && git fetch upstream
git rebase upstream/main   # on a new branch first, then fast-forward remaxhub
TZ=UTC yarn vitest run packages/app-store/zohocalendar && yarn type-check:ci --force
```

Monthly, or within 48 h of a critical security fix.

## Tracking security fixes

Upstream doesn't reliably ship fixes or advisories (calcom/cal.com redirects here; reported CVEs sat unanswered in 2026), so we watch and patch ourselves.

- GitHub: Watch → Custom → Security alerts on `vercel/next.js` and `calcom/cal.diy`; Dependabot security updates on `myi1/cal.diy`.
- Feeds: https://github.com/vercel/next.js/releases.atom, https://nextjs.org/feed.xml, https://github.com/calcom/cal.diy/commits/main.atom
- Polling: `gh api '/advisories?affects=next&ecosystem=npm'`, `gh api '/advisories?affects=next-auth&ecosystem=npm'`, and open cal.diy PRs mentioning security/CVE/GHSA.
- `yarn npm audit --severity critical` before each image build.

## Gotchas

- Signup is off at build time (`NEXT_PUBLIC_DISABLE_SIGNUP=true`). Users are created by admin or by the setup script.
- An ADMIN only gets admin powers in the web UI with a 15+ character password and 2FA on; otherwise the session is `INACTIVE_ADMIN`. API keys don't have this check.
- `mark-absent` needs the booking owner's key. Hub Admin uses one `hub-bot` ADMIN key, which covers booking, reschedule, cancel and PATCH location, not mark-absent.
- `PATCH /v2/bookings/{uid}/location` emails the lead a "location changed" email and is throttled to 5/min.
- Webhooks can only be created by their owner, so the setup script creates one per advisor.
- `MEETING_ENDED`/`MEETING_STARTED` webhooks only fire when `/api/cron/webhookTriggers` is called (the cron above).
