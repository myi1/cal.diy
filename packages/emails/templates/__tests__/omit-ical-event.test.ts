import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@calcom/types/Calendar";

import BaseEmail from "../_base-email";
import AttendeeWasRequestedToRescheduleEmail from "../attendee-was-requested-to-reschedule-email";
import OrganizerScheduledEmail from "../organizer-scheduled-email";

class StubEmail extends BaseEmail {
  constructor(omit: boolean) {
    super();
    this.omitIcalEvent = omit;
  }
  protected async getNodeMailerPayload() {
    return { to: "a@example.com", subject: "s", icalEvent: { filename: "event.ics", content: "x" } };
  }
  payloadForSending() {
    return this.getPayloadForSending();
  }
}

const calEvent = {
  organizer: { language: { translate: (k: string) => k, locale: "en" }, name: "Host", email: "h@x", timeZone: "UTC" },
  attendees: [{ language: { translate: (k: string) => k, locale: "en" }, name: "Lead", email: "l@x", timeZone: "UTC" }],
} as unknown as CalendarEvent;

const omits = (email: unknown) => (email as { omitIcalEvent: boolean }).omitIcalEvent;

describe("omitIcalEvent", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the invite by default and drops it when set", async () => {
    expect(await new StubEmail(false).payloadForSending()).toHaveProperty("icalEvent");
    const stripped = await new StubEmail(true).payloadForSending();
    expect(stripped).not.toHaveProperty("icalEvent");
    expect(stripped).toMatchObject({ to: "a@example.com", subject: "s" });
  });

  it("host emails omit the invite only when REMAXHUB_ORGANIZER_ICS=off", () => {
    expect(omits(new OrganizerScheduledEmail({ calEvent }))).toBe(false);
    vi.stubEnv("REMAXHUB_ORGANIZER_ICS", "off");
    expect(omits(new OrganizerScheduledEmail({ calEvent }))).toBe(true);
  });

  it("the attendee reschedule-request email keeps its invite", () => {
    vi.stubEnv("REMAXHUB_ORGANIZER_ICS", "off");
    expect(omits(new AttendeeWasRequestedToRescheduleEmail(calEvent, { rescheduleLink: "" }))).toBe(false);
  });
});
