import type { TFunction } from "i18next";

import { guessEventLocationType } from "@calcom/app-store/locations";
import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import type { CalendarEvent } from "@calcom/types/Calendar";

import { Info } from "./Info";

export function LocationInfo(props: { calEvent: CalendarEvent; t: TFunction; forAttendee?: boolean }) {
  const { t } = props;

  // We would not be able to determine provider name for DefaultEventLocationTypes
  const providerName = guessEventLocationType(props.calEvent.location)?.label;

  const location = props.calEvent.location;
  let meetingUrl = location?.search(/^https?:/) !== -1 ? location : undefined;

  if (props.calEvent) {
    meetingUrl = getVideoCallUrlFromCalEvent(props.calEvent) || meetingUrl;
  }

  const isPhone = location?.startsWith("+");

  // Because of location being a value here, we can determine the app that generated the location only for Dynamic Link based apps where the value is integrations:*
  // For static link based location apps, the value is that URL itself. So, it is not straightforward to determine the app that generated the location.
  // If we know the App we can always provide the name of the app like we do it for Google Hangout/Google Meet

  // remaxhub: the buyer gets one clear button; the advisor (who joins from Hub) sees it as the buyer's link.
  if (meetingUrl && props.forAttendee) {
    return (
      <Info
        label={t("where")}
        withSpacer
        description={<JoinButton href={meetingUrl} />}
        extraInfo={
          <div style={{ color: "#494949", fontWeight: 400, lineHeight: "20px", fontSize: "13px" }}>
            Or open this link:{" "}
            <a href={meetingUrl} style={{ color: "#003DA5", wordBreak: "break-all" }}>
              {meetingUrl}
            </a>
          </div>
        }
      />
    );
  }

  if (meetingUrl && !providerName) {
    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          <div style={{ color: "#101010", fontWeight: 400, lineHeight: "24px" }}>
            Buyer&apos;s link:{" "}
            <a href={meetingUrl} style={{ color: "#003DA5", wordBreak: "break-all" }}>
              {meetingUrl}
            </a>
          </div>
        }
      />
    );
  }

  if (meetingUrl) {
    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          <a
            href={meetingUrl}
            target="_blank"
            title={t("meeting_url")}
            style={{ color: "#101010" }}
            rel="noreferrer">
            {providerName || "Link"}
          </a>
        }
        extraInfo={
          meetingUrl && (
            <div style={{ color: "#494949", fontWeight: 400, lineHeight: "24px" }}>
              <>
                {t("meeting_url")}:{" "}
                <a href={meetingUrl} title={t("meeting_url")} style={{ color: "#003DA5" }}>
                  {meetingUrl}
                </a>
              </>
            </div>
          )
        }
      />
    );
  }

  if (isPhone) {
    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          <a href={`tel:${location}`} title="Phone" style={{ color: "#003DA5" }}>
            {location}
          </a>
        }
      />
    );
  }

  return (
    <Info
      label={t("where")}
      withSpacer
      description={providerName || location}
      extraInfo={
        (providerName === "Zoom" || providerName === "Google") && props.calEvent.requiresConfirmation ? (
          <p style={{ color: "#494949", fontWeight: 400, lineHeight: "24px" }}>
            <>{t("meeting_url_provided_after_confirmed")}</>
          </p>
        ) : null
      }
    />
  );
}

function JoinButton({ href }: { href: string }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "separate", margin: "4px 0 10px" }}>
      <tbody>
        <tr>
          <td style={{ background: "#003DA5", borderRadius: "8px" }}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "13px 26px",
                fontFamily: "'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif",
                fontSize: "16px",
                fontWeight: 700,
                lineHeight: "20px",
                color: "#FFFFFF",
                textDecoration: "none",
                borderRadius: "8px",
              }}>
              Join the call
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
