// remaxhub: Cal fills an event name once, from the host's side, and stores it as the booking title, so
// "{HOST/ATTENDEE}" shows the buyer their own name. For emails to the attendee we recompute the title from
// their side ("REMAX Hub call with <advisor>"); the stored title, the calendar event and the host's emails
// keep the host's side ("REMAX Hub call with <buyer>").
import dayjs from "@calcom/dayjs";
import { getEventName } from "@calcom/features/eventtypes/lib/eventNaming";
import prisma from "@calcom/prisma";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

type EventTypeNaming = { eventName: string | null; title: string } | null;
export type LoadEventTypeNaming = (eventTypeId: number) => Promise<EventTypeNaming>;

const loadFromDb: LoadEventTypeNaming = (eventTypeId) =>
  prisma.eventType.findUnique({ where: { id: eventTypeId }, select: { eventName: true, title: true } });

export async function getAttendeeFacingTitle(
  calEvent: CalendarEvent,
  attendee: Person,
  load: LoadEventTypeNaming = loadFromDb
): Promise<string | null> {
  if (!calEvent.eventTypeId) return null;
  const eventType = await load(calEvent.eventTypeId);
  if (!eventType?.eventName?.includes("{HOST/ATTENDEE}")) return null;
  return getEventName(
    {
      eventName: eventType.eventName,
      eventType: eventType.title,
      host: calEvent.organizer.name,
      attendeeName: attendee.name,
      eventDuration: dayjs(calEvent.endTime).diff(calEvent.startTime, "minutes"),
      t: attendee.language.translate,
      ...(calEvent.location && { location: calEvent.location }),
      ...(calEvent.responses && { bookingFields: calEvent.responses }),
    },
    true
  );
}
