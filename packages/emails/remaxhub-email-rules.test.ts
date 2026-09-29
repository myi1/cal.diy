import { beforeEach, describe, expect, it, vi } from "vitest";

import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import type { CalendarEvent } from "@calcom/types/Calendar";

const sent = vi.hoisted(() => [] as string[]);

vi.mock("@calcom/prisma", () => ({ prisma: {}, default: {} }));
vi.mock("./templates/attendee-cancelled-email", () => ({
  default: class {
    sendEmail() {
      sent.push("attendee-cancelled");
      return Promise.resolve();
    }
  },
}));
vi.mock("./templates/organizer-cancelled-email", () => ({
  default: class {
    sendEmail() {
      sent.push("organizer-cancelled");
      return Promise.resolve();
    }
  },
}));
vi.mock("../sms/attendee/event-cancelled-sms", () => ({
  default: class {
    sendSMSToAttendees() {
      return Promise.resolve();
    }
  },
}));

import { isHandoverCancellation, sendCancelledEmailsAndSMS } from "./email-manager";

const t = ((k: string) => k) as unknown as CalendarEvent["organizer"]["language"]["translate"];
const person = (email: string) => ({
  name: "P",
  email,
  timeZone: "Europe/London",
  language: { translate: t, locale: "en" },
});
const calEvent = (cancellationReason: string | null): CalendarEvent =>
  ({
    type: "video-call",
    title: "Free 15-minute video call",
    startTime: "2026-10-01T12:00:00Z",
    endTime: "2026-10-01T12:15:00Z",
    length: 15,
    organizer: person("advisor@remaxhub.ae"),
    attendees: [person("lead@example.com")],
    cancellationReason,
  }) as unknown as CalendarEvent;

describe("placeholder attendee emails", () => {
  it("treats Hub's no-email leads and Cal's phone-only leads as placeholders, bare or named", () => {
    expect(isSmsCalEmail("lead-abc123@no-email.remaxhub.ae")).toBe(true);
    expect(isSmsCalEmail("Jane Buyer <lead-abc123@no-email.remaxhub.ae>")).toBe(true);
    expect(isSmsCalEmail("LEAD-X@NO-EMAIL.REMAXHUB.AE")).toBe(true);
    expect(isSmsCalEmail("+447400123456@sms.cal.com")).toBe(true);
  });

  it("leaves real addresses alone, including look-alikes", () => {
    expect(isSmsCalEmail("jane@example.co.uk")).toBe(false);
    expect(isSmsCalEmail("Jane <jane@example.co.uk>")).toBe(false);
    expect(isSmsCalEmail("no-email.remaxhub.ae@gmail.com")).toBe(false);
    expect(isSmsCalEmail("x@no-email.remaxhub.ae.evil.com")).toBe(false);
  });
});

describe("handover cancellation", () => {
  beforeEach(() => sent.splice(0));

  it("recognises the [handover] prefix only", () => {
    expect(isHandoverCancellation("[handover] to Sunil")).toBe(true);
    expect(isHandoverCancellation("  [handover]")).toBe(true);
    expect(isHandoverCancellation("lead cancelled [handover]")).toBe(false);
    expect(isHandoverCancellation(null)).toBe(false);
  });

  it("emails the advisor but not the lead", async () => {
    await sendCancelledEmailsAndSMS(calEvent("[handover] to Sunil"), { eventName: "call" });
    expect(sent).toEqual(["organizer-cancelled"]);
  });

  it("still emails the lead on a normal cancellation", async () => {
    await sendCancelledEmailsAndSMS(calEvent("Lead asked to cancel"), { eventName: "call" });
    expect(sent.sort()).toEqual(["attendee-cancelled", "organizer-cancelled"]);
  });
});
