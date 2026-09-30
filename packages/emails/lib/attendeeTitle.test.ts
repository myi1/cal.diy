import { describe, expect, it, vi } from "vitest";

import type { CalendarEvent, Person } from "@calcom/types/Calendar";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));

import { getAttendeeFacingTitle } from "./attendeeTitle";

const t = ((k: string) => k) as unknown as Person["language"]["translate"];
const buyer = { name: "James Wilson", email: "j@example.co.uk", timeZone: "Europe/London", language: { translate: t, locale: "en" } } as Person;
const calEvent = {
  eventTypeId: 4,
  title: "REMAX Hub call with James Wilson",
  startTime: "2026-10-02T11:00:00Z",
  endTime: "2026-10-02T11:15:00Z",
  organizer: { name: "Kanchan Madnani", email: "k@remaxhub.ae", timeZone: "Asia/Dubai", language: { translate: t, locale: "en" } },
  attendees: [buyer],
} as unknown as CalendarEvent;

describe("getAttendeeFacingTitle", () => {
  it("names the advisor for the buyer when the template uses {HOST/ATTENDEE}", async () => {
    const load = vi.fn().mockResolvedValue({ eventName: "REMAX Hub call with {HOST/ATTENDEE}", title: "video-call" });
    expect(await getAttendeeFacingTitle(calEvent, buyer, load)).toBe("REMAX Hub call with Kanchan Madnani");
    expect(load).toHaveBeenCalledWith(4);
  });

  it("leaves other templates alone", async () => {
    const load = vi.fn().mockResolvedValue({ eventName: "REMAX Hub call: {ATTENDEE} with {HOST}", title: "x" });
    expect(await getAttendeeFacingTitle(calEvent, buyer, load)).toBeNull();
    expect(await getAttendeeFacingTitle(calEvent, buyer, vi.fn().mockResolvedValue({ eventName: null, title: "x" }))).toBeNull();
  });

  it("does nothing without an event type", async () => {
    const load = vi.fn();
    expect(await getAttendeeFacingTitle({ ...calEvent, eventTypeId: undefined }, buyer, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
