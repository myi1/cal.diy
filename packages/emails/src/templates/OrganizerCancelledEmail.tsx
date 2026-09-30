import { SchedulingType } from "@calcom/prisma/enums";

import { isHandoverCancellation } from "../../lib/handover";
import { OrganizerScheduledEmail } from "./OrganizerScheduledEmail";

export const OrganizerCancelledEmail = (props: React.ComponentProps<typeof OrganizerScheduledEmail>) => {
  const t = props.teamMember?.language.translate || props.calEvent.organizer.language.translate;
  const title = "event_request_cancelled";
  const subject = "event_cancelled_subject";
  const isRoundRobin = props.calEvent.schedulingType === SchedulingType.ROUND_ROBIN;
  const subtitle = isHandoverCancellation(props.calEvent.cancellationReason)
    ? "Handed over to another advisor. The buyer keeps the same time and link, and hasn't been emailed."
    : props.reassigned
      ? isRoundRobin
        ? t("event_reassigned_subtitle")
        : t("event_reassigned_subtitle_generic")
      : "";
  return (
    <OrganizerScheduledEmail
      title={title}
      subtitle={subtitle}
      headerType="xCircle"
      subject={subject}
      callToAction={null}
      reassigned={props.reassigned}
      {...props}
    />
  );
};
