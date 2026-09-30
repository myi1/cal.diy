// remaxhub: Hub hands a call to another advisor by cancelling it with a reason starting "[handover]" and
// rebooking the same time and link with the new advisor. The lead keeps their call and isn't emailed.
export const HANDOVER_CANCELLATION_PREFIX = "[handover]";

export const isHandoverCancellation = (cancellationReason?: string | null) =>
  !!cancellationReason?.trim().startsWith(HANDOVER_CANCELLATION_PREFIX);
