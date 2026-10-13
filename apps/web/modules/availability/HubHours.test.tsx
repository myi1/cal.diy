import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubHours, HubHoursBanner, HubManagedScheduleRow, hubManagedSchedule } from "./HubHours";

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

const weekly = [
  { days: [1, 2, 3, 4, 5], startTime: t("09:00"), endTime: t("18:00"), date: null },
  { days: [6], startTime: t("00:00"), endTime: t("23:59"), date: null },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hubManagedSchedule", () => {
  it("manages nothing by default", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "");
    expect(hubManagedSchedule(1)).toBe(false);
    expect(hubManagedSchedule(18)).toBe(false);
  });

  it("manages only the listed ids, tolerating spaces and empty entries", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", " 3, 14,,20 ");
    expect(hubManagedSchedule(3)).toBe(true);
    expect(hubManagedSchedule(14)).toBe(true);
    expect(hubManagedSchedule(20)).toBe(true);
    expect(hubManagedSchedule(4)).toBe(false);
    expect(hubManagedSchedule(1)).toBe(false);
  });

  it("refuses restriction schedules 7-12 even when listed", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "6,7,8,9,10,11,12,13");
    for (const id of [7, 8, 9, 10, 11, 12]) expect(hubManagedSchedule(id)).toBe(false);
    expect(hubManagedSchedule(6)).toBe(true);
    expect(hubManagedSchedule(13)).toBe(true);
  });
});

describe("HubHours", () => {
  it("says the hours are set in the Hub and shows the zone", () => {
    const html = renderToStaticMarkup(<HubHours hours={weekly} zone="Asia/Dubai" />);
    expect(html).toContain("Hours are set in the Hub.");
    expect(html).toContain("Change your shifts and blocks in Settings → You → Schedule.");
    expect(html).toContain("Times shown in Asia/Dubai.");
  });

  it("lists days and 24-hour times", () => {
    const html = renderToStaticMarkup(<HubHours hours={weekly} zone="Asia/Dubai" />);
    expect(html).toContain("Monday, Tuesday, Wednesday, Thursday, Friday");
    expect(html).toContain("09:00–18:00");
  });

  it("shows a day ending at midnight (stored as 23:59) as 24:00", () => {
    const html = renderToStaticMarkup(<HubHours hours={weekly} zone="Asia/Dubai" />);
    expect(html).toContain("Saturday");
    expect(html).toContain("00:00–24:00");
    expect(html).not.toContain("23:59");
  });

  it("shows a part-day override with its date", () => {
    const html = renderToStaticMarkup(
      <HubHours
        hours={[...weekly, { days: [], startTime: t("10:00"), endTime: t("13:00"), date: new Date("2026-10-20T00:00:00.000Z") }]}
        zone="Asia/Dubai"
      />
    );
    expect(html).toContain("2026-10-20");
    expect(html).toContain("10:00–13:00");
  });

  it("shows a 00:00-00:00 override as unavailable all day", () => {
    const html = renderToStaticMarkup(
      <HubHours
        hours={[{ days: [], startTime: t("00:00"), endTime: t("00:00"), date: new Date("2026-10-21T00:00:00.000Z") }]}
        zone="Asia/Dubai"
      />
    );
    expect(html).toContain("2026-10-21");
    expect(html).toContain("Unavailable all day");
    expect(html).not.toContain("00:00–00:00");
  });

  it("accepts ISO strings (serialised server data)", () => {
    const html = renderToStaticMarkup(
      <HubHours
        hours={[{ days: [0], startTime: "1970-01-01T08:30:00.000Z", endTime: "1970-01-01T23:59:00.000Z", date: null }]}
        zone="Europe/London"
      />
    );
    expect(html).toContain("Sunday: 08:30–24:00");
  });

  it("has no enabled save, delete, default or other controls", () => {
    const html = renderToStaticMarkup(<HubHours hours={weekly} zone="Asia/Dubai" />);
    for (const tag of ["<button", "<input", "<form", "<select", "<textarea", "contenteditable"]) {
      expect(html).not.toContain(tag);
    }
    expect(html).not.toMatch(/save|delete|make default|duplicate/i);
  });
});

describe("list view pieces", () => {
  it("renders the banner sentence", () => {
    const html = renderToStaticMarkup(<HubHoursBanner />);
    expect(html).toContain("Hours are set in the Hub.");
    expect(html).toContain("Change your shifts and blocks in Settings → You → Schedule.");
  });

  it("renders a managed row as a link with its hours and no mutation menu", () => {
    const html = renderToStaticMarkup(
      <HubManagedScheduleRow
        schedule={{ id: 3, name: "Working hours", timeZone: "Asia/Dubai", availability: weekly }}
        redirectUrl="/availability/3"
      />
    );
    expect(html).toContain('href="/availability/3"');
    expect(html).toContain("Working hours");
    expect(html).toContain("09:00–18:00");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/delete|duplicate|make default/i);
  });

  it("keeps the Default badge, sorts rows by day and falls back to the user's zone", () => {
    const html = renderToStaticMarkup(
      <HubManagedScheduleRow
        schedule={{
          id: 3,
          name: "Working hours",
          isDefault: true,
          timeZone: null,
          availability: [
            { days: [5], startTime: t("10:00"), endTime: t("14:00"), date: null },
            { days: [1], startTime: t("09:00"), endTime: t("18:00"), date: null },
          ],
        }}
        redirectUrl="/availability/3"
        fallbackZone="Asia/Dubai"
      />
    );
    expect(html).toContain("Default");
    expect(html).toContain("(Asia/Dubai)");
    expect(html.indexOf("Mon: 09:00–18:00")).toBeGreaterThan(-1);
    expect(html.indexOf("Mon: 09:00–18:00")).toBeLessThan(html.indexOf("Fri: 10:00–14:00"));
  });

  it("leaves unmanaged schedules to the existing list item", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "3");
    const unmanaged = [1, 2, 4, 7].filter((id) => !hubManagedSchedule(id));
    expect(unmanaged).toEqual([1, 2, 4, 7]);
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "");
    expect(hubManagedSchedule(3)).toBe(false);
  });
});
