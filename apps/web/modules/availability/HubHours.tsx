import Link from "next/link";

// Restriction schedules 7-12 belong to call-restriction rules and are never Hub-managed.
const RESTRICTION_SCHEDULE_IDS = [7, 8, 9, 10, 11, 12];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * True when a schedule's hours are owned by the Hub. Reads the build-time env
 * NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS (comma-separated schedule ids). Default empty:
 * nothing is managed. Restriction schedules 7-12 are refused even if listed.
 */
export function hubManagedSchedule(id: number): boolean {
  if (!Number.isInteger(id) || RESTRICTION_SCHEDULE_IDS.includes(id)) return false;
  const listed = (process.env.NEXT_PUBLIC_HUB_MANAGED_SCHEDULE_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return listed.includes(String(id));
}

export type HubHoursRow = {
  days: number[];
  startTime: Date | string;
  endTime: Date | string;
  date?: Date | string | null;
};

const hhmm = (value: Date | string) => new Date(value).toISOString().slice(11, 16);

// A window that ends at midnight is stored as 23:59 (Cal rejects 24:00), so show it as 24:00.
const endLabel = (value: Date | string) => {
  const text = hhmm(value);
  return text === "23:59" ? "24:00" : text;
};

const range = (row: HubHoursRow) => `${hhmm(row.startTime)}–${endLabel(row.endTime)}`;

const isFullDayOff = (row: HubHoursRow) => hhmm(row.startTime) === "00:00" && hhmm(row.endTime) === "00:00";

const dateLabel = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

export function HubHoursBanner() {
  return (
    <div role="note" className="border-subtle bg-cal-muted text-default mb-4 rounded-md border px-4 py-3 text-sm">
      <p className="text-emphasis font-medium">Hours are set in the Hub.</p>
      <p>Change your shifts and blocks in Settings → You → Schedule.</p>
    </div>
  );
}

export function HubHours({ hours, zone }: { hours: HubHoursRow[]; zone: string }) {
  const weekly = hours.filter((row) => !row.date);
  const overrides = hours
    .filter((row) => !!row.date)
    .sort((a, b) => dateLabel(a.date as Date | string).localeCompare(dateLabel(b.date as Date | string)));

  return (
    <section aria-label="Working hours" className="text-default text-sm">
      <HubHoursBanner />
      <p className="text-subtle mb-4">Times shown in {zone}.</p>
      <ul className="mb-4 space-y-1">
        {weekly.map((row, index) => (
          <li key={index}>
            {row.days.map((day) => DAY_NAMES[day]).join(", ")}: {range(row)}
          </li>
        ))}
      </ul>
      {overrides.length > 0 && (
        <>
          <h2 className="text-emphasis mb-1 font-medium">Date overrides</h2>
          <ul className="space-y-1">
            {overrides.map((row, index) => (
              <li key={index}>
                {dateLabel(row.date as Date | string)}: {isFullDayOff(row) ? "Unavailable all day" : range(row)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** One managed row for the availability list: a link and a summary, no mutation menu. */
export function HubManagedScheduleRow({
  schedule,
  redirectUrl,
}: {
  schedule: { id: number; name: string; timeZone?: string | null; availability: HubHoursRow[] };
  redirectUrl: string;
}) {
  const weekly = schedule.availability.filter((row) => !row.date && row.days.length > 0);
  return (
    <li>
      <div className="hover:bg-cal-muted flex items-center justify-between px-3 py-5 transition sm:px-4">
        <Link href={redirectUrl} className="grow truncate text-sm" title={schedule.name}>
          <span className="text-emphasis truncate font-medium">{schedule.name}</span>
          <p className="text-subtle mt-1">
            {weekly.length === 0
              ? "No weekly hours"
              : weekly
                  .map((row) => `${row.days.map((day) => DAY_NAMES[day]?.slice(0, 3)).join(", ")}: ${range(row)}`)
                  .join(" · ")}
            {schedule.timeZone ? ` (${schedule.timeZone})` : ""}
          </p>
        </Link>
      </div>
    </li>
  );
}
