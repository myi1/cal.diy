import { afterEach, describe, expect, it, vi } from "vitest";

import { hubManagedSchedule } from "./hubManagedSchedule";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hubManagedSchedule", () => {
  it("manages nothing when the variable is unset or empty", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "");
    expect(hubManagedSchedule(3)).toBe(false);
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS;
    expect(hubManagedSchedule(3)).toBe(false);
  });

  it("matches whole ids only", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "13,140");
    expect(hubManagedSchedule(13)).toBe(true);
    expect(hubManagedSchedule(140)).toBe(true);
    expect(hubManagedSchedule(1)).toBe(false);
    expect(hubManagedSchedule(14)).toBe(false);
  });

  it("refuses restriction schedules 7-12, null, undefined and non-integers", () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "7,8,9,10,11,12,1.5,NaN");
    for (const id of [7, 8, 9, 10, 11, 12]) expect(hubManagedSchedule(id)).toBe(false);
    expect(hubManagedSchedule(null)).toBe(false);
    expect(hubManagedSchedule(undefined)).toBe(false);
    expect(hubManagedSchedule(1.5)).toBe(false);
    expect(hubManagedSchedule(Number.NaN)).toBe(false);
  });
});
