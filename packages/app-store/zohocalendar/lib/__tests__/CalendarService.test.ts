import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CalendarServiceEvent } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";

import BuildCalendarService from "../CalendarService";

vi.mock("@calcom/prisma", () => ({ default: { credential: { update: vi.fn() } } }));
vi.mock("../../../_utils/getAppKeysFromSlug", () => ({
  default: vi.fn().mockResolvedValue({ client_id: "id", client_secret: "secret" }),
}));

const credential = {
  id: 1,
  appId: "zohocalendar",
  type: "zoho_calendar",
  userId: 7,
  user: { email: "advisor@remaxhub.ae" },
  teamId: null,
  key: {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: Math.round(Date.now() / 1000) + 3600,
    server_location: "com",
  },
  encryptedKey: null,
  invalid: false,
  delegationCredentialId: null,
} as unknown as CredentialPayload;

const event = {
  title: "Free 15-minute video call",
  calendarDescription: "",
  startTime: "2026-10-26T10:00:00Z",
  endTime: "2026-10-26T10:15:00Z",
  organizer: { timeZone: "Asia/Dubai", email: "advisor@remaxhub.ae", name: "Advisor" },
  attendees: [{ email: "lead@example.com", name: "Lead", timeZone: "Europe/London" }],
  destinationCalendar: [{ externalId: "cal-1", integration: "zoho_calendar" }],
} as unknown as CalendarServiceEvent;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const eventdataOf = (url: string) =>
  JSON.parse(new URL(url).searchParams.get("eventdata") ?? "{}") as Record<string, unknown>;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ZohoCalendarService", () => {
  test("createEvent tells Zoho not to notify attendees", async () => {
    fetchMock.mockResolvedValueOnce(json({ events: [{ uid: "evt-1" }] }));

    await BuildCalendarService(credential).createEvent(event, 1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(eventdataOf(url).notify_attendee).toBe(0);
  });

  test("updateEvent tells Zoho not to notify attendees", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ events: [{ uid: "evt-1", etag: "e1" }] }))
      .mockResolvedValueOnce(json({ events: [{ uid: "evt-1" }] }));

    await BuildCalendarService(credential).updateEvent("evt-1", event);

    const [url, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe("PUT");
    expect(eventdataOf(url).notify_attendee).toBe(0);
  });

  test("deleteEvent tells Zoho not to notify attendees", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ events: [{ uid: "evt-1", etag: "e1" }] }))
      .mockResolvedValueOnce(json({ events: [{ uid: "evt-1" }] }));

    await BuildCalendarService(credential).deleteEvent("evt-1", event as never);

    const [url, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe("DELETE");
    expect(eventdataOf(url).notify_attendee).toBe(0);
  });

  test("getAvailability fails closed when Zoho rejects the token", async () => {
    fetchMock.mockResolvedValue(json({ error: "INVALID_OAUTHTOKEN" }, 401));

    const dateFrom = "2026-10-26T00:00:00.000Z";
    const dateTo = "2026-10-27T00:00:00.000Z";
    const busy = await BuildCalendarService(credential).getAvailability({
      dateFrom,
      dateTo,
      selectedCalendars: [{ externalId: "cal-1", integration: "zoho_calendar" }],
    } as never);

    expect(busy).toEqual([{ start: dateFrom, end: dateTo }]);
  });
});
