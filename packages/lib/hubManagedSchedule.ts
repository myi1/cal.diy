// Restriction schedules 7-12 belong to call-restriction rules and are never Hub-managed.
const RESTRICTION_SCHEDULE_IDS = [7, 8, 9, 10, 11, 12];

/**
 * True when a schedule's hours are owned by the Hub. Reads the build-time env
 * NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS (comma-separated schedule ids; NEXT_PUBLIC_* values are inlined into
 * both the client and server bundles). Default empty: nothing is managed. Restriction schedules 7-12 are
 * refused even if listed.
 */
export function hubManagedSchedule(id: number | null | undefined): boolean {
  if (typeof id !== "number" || !Number.isInteger(id) || RESTRICTION_SCHEDULE_IDS.includes(id)) return false;
  const listed = (process.env.NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return listed.includes(String(id));
}
