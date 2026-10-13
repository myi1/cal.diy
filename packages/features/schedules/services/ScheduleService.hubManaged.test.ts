import type { PrismaClient } from "@calcom/prisma";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleService } from "./ScheduleService";

const user = { id: 1, defaultScheduleId: 3, timeZone: "Asia/Dubai" };

const serviceWith = (findUnique: ReturnType<typeof vi.fn>) =>
  new ScheduleService({ schedule: { findUnique } } as unknown as PrismaClient);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ScheduleService.update with Hub-owned hours", () => {
  it("refuses to change a managed schedule and never touches the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "3");
    const findUnique = vi.fn();
    await expect(
      serviceWith(findUnique).update({ input: { scheduleId: 3, name: "Hours", schedule: [] }, user })
    ).rejects.toMatchObject({ statusCode: 403, message: "Hours are set in the Hub." });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("refuses to make another schedule the default while the default is managed", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "3");
    const findUnique = vi.fn();
    await expect(
      serviceWith(findUnique).update({ input: { scheduleId: 5, isDefault: true }, user })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("leaves unmanaged schedules to the normal path", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "");
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      serviceWith(findUnique).update({ input: { scheduleId: 5, isDefault: true }, user })
    ).rejects.toMatchObject({ statusCode: 401, message: "Unauthorized" });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("lets other schedules be edited when only a different schedule is managed", async () => {
    vi.stubEnv("NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS", "3");
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      serviceWith(findUnique).update({ input: { scheduleId: 5, name: "Mine", schedule: [] }, user })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
