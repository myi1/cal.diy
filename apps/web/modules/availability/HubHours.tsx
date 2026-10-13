import Link from "next/link";

import { hubManagedSchedule } from "@calcom/lib/hubManagedSchedule";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export { hubManagedSchedule };

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

const sortByFirstDay = <T extends { days: number[] }>(rows: T[]) =>
  [...rows].sort((a, b) => Math.min(...a.days, 7) - Math.min(...b.days, 7));

export function HubHoursBanner() {
  return (
    <div role="note" className="border-subtle bg-cal-muted text-default mb-4 rounded-md border px-4 py-3 text-sm">
      <p className="text-emphasis font-medium">Hours are set in the Hub.</p>
      <p>Change your shifts and blocks in Settings → You → Schedule.</p>
    </div>
  );
}

export function HubHours({ hours, zone }: { hours: HubHoursRow[]; zone: string }) {
  const weekly = sortByFirstDay(hours.filter((row) => !row.date));
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
  fallbackZone,
}: {
  schedule: {
    id: number;
    name: string;
    isDefault?: boolean;
    timeZone?: string | null;
    availability: HubHoursRow[];
  };
  redirectUrl: string;
  /** Shown when the schedule has no zone of its own (it then follows the user's zone). */
  fallbackZone?: string | null;
}) {
  const weekly = sortByFirstDay(schedule.availability.filter((row) => !row.date && row.days.length > 0));
  const zone = schedule.timeZone || fallbackZone;
  return (
    <li>
      <div className="hover:bg-cal-muted flex items-center justify-between px-3 py-5 transition sm:px-4">
        <Link href={redirectUrl} className="grow truncate text-sm" title={schedule.name}>
          <div className="space-x-2 rtl:space-x-reverse">
            <span className="text-emphasis truncate font-medium">{schedule.name}</span>
            {schedule.isDefault && <span className="bg-subtle text-emphasis rounded px-1.5 py-0.5 text-xs">Default</span>}
          </div>
          <p className="text-subtle mt-1">
            {weekly.length === 0
              ? "No weekly hours"
              : weekly
                  .map((row) => `${row.days.map((day) => DAY_NAMES[day]?.slice(0, 3)).join(", ")}: ${range(row)}`)
                  .join(" · ")}
            {zone ? ` (${zone})` : ""}
          </p>
        </Link>
      </div>
    </li>
  );
}
