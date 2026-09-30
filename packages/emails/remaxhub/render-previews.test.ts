// remaxhub: renders the booking emails with sample data so their look can be checked without sending.
// Opt-in: RENDER_PREVIEWS=1 TZ=UTC yarn vitest run packages/emails/remaxhub/render-previews.test.ts
// Output: $PREVIEW_DIR (default /tmp/caldiy-email-previews)/*.html
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent } from "@calcom/types/Calendar";

import renderEmail from "../src/renderEmail";

const OUT = process.env.PREVIEW_DIR || "/tmp/caldiy-email-previews";
const PUBLIC = path.resolve(__dirname, "../../../apps/web/public");
const DESCRIPTION = fs
  .readFileSync(path.resolve(__dirname, "../../../deploy/remaxhub/event-type-description.txt"), "utf8")
  .trim();

describe.skipIf(!process.env.RENDER_PREVIEWS)("REMAX Hub email previews", () => {
  it("renders the booking emails", async () => {
    const t = await getTranslation("en", "common");
    const advisor = {
      name: "Kanchan Madnani",
      email: "kanchan.madnani@remaxhub.ae",
      timeZone: "Asia/Dubai",
      timeFormat: "HH:mm",
      language: { translate: t, locale: "en" },
    };
    const lead = {
      name: "James Wilson",
      email: "james.wilson@example.co.uk",
      timeZone: "Europe/London",
      phoneNumber: "+447400123456",
      language: { translate: t, locale: "en" },
    };
    const calEvent = {
      type: "video-call",
      title: "Free 15-minute video call between Kanchan Madnani and James Wilson",
      description: DESCRIPTION,
      startTime: "2026-10-02T11:00:00Z",
      endTime: "2026-10-02T11:15:00Z",
      organizer: advisor,
      attendees: [lead],
      location: "https://meet.remaxhub.ae/K7Q2MX",
      uid: "preview-booking-uid",
      hideBranding: true,
      appsStatus: undefined,
      responses: { attendeePhoneNumber: { label: "WhatsApp number", value: "+447400123456" } },
    } as unknown as CalendarEvent;
    const cancelled = { ...calEvent, cancellationReason: "I can't make that time any more" } as CalendarEvent;
    const handedOver = { ...calEvent, cancellationReason: "[handover] to Sunil Rawat" } as CalendarEvent;

    const emails: [string, keyof typeof import("../src/templates"), Record<string, unknown>][] = [
      ["lead-booked", "AttendeeScheduledEmail", { calEvent, attendee: lead }],
      ["lead-moved", "AttendeeRescheduledEmail", { calEvent, attendee: lead }],
      ["lead-cancelled", "AttendeeCancelledEmail", { calEvent: cancelled, attendee: lead }],
      ["lead-link-changed", "AttendeeLocationChangeEmail", { calEvent, attendee: lead }],
      ["advisor-booked", "OrganizerScheduledEmail", { calEvent, attendee: advisor }],
      ["advisor-moved", "OrganizerRescheduledEmail", { calEvent, attendee: advisor }],
      ["advisor-cancelled", "OrganizerCancelledEmail", { calEvent: cancelled, attendee: advisor }],
      ["advisor-cancelled-handover", "OrganizerCancelledEmail", { calEvent: handedOver, attendee: advisor }],
    ];

    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, template, props] of emails) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const html = await renderEmail(template, props as any);
      // Point images at the repo's files so the preview shows them offline.
      const local = html.replace(/https?:\/\/[^"']+\/emails\//g, `file://${PUBLIC}/emails/`);
      fs.writeFileSync(path.join(OUT, `${name}.html`), local);
      expect(html).toContain("REMAX Hub");
    }
  });
});
