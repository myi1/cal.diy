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

## Deploy a new image

1. Push to `remaxhub` (or run the workflow). Wait for both jobs to go green.
2. `ssh root@100.108.208.27 'docker exec postgres-<uuid> pg_dump -U calcom -d calcom -Fc' > before-upgrade.dump`, or run `/usr/local/bin/caldiy-backup.sh`.
3. Set `IMAGE_TAG` in the service's Coolify env (API: `PATCH /services/<uuid>/envs`), then deploy. If Coolify's restart fails with "No such container", run `docker compose -p <uuid> up -d` in `/data/coolify/services/<uuid>`.
4. Smoke test: `GET https://book-api.remaxhub.ae/v2/slots?...` returns slots, one booking by API, cancel it, check the webhook arrived at Hub Admin.

Rollback: set `IMAGE_TAG` back to the previous tag. Restore the dump only if the new version ran a database migration that the old one can't read.

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
