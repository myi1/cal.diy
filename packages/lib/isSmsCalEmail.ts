// Placeholder attendee addresses that have no mailbox: Cal's own phone-only bookings, and REMAX Hub's
// WhatsApp-only leads (Hub books them as lead-<hubCallId>@no-email.remaxhub.ae). Nothing is emailed to
// them and they're hidden wherever an attendee's email would be shown.
const PLACEHOLDER_EMAIL_DOMAINS = ["@sms.cal.com", "@no-email.remaxhub.ae"];

export default function isSmsCalEmail(email: string) {
  // Emails are addressed as "Name <address>"; compare the address itself.
  const address = (email.match(/<([^>]+)>\s*$/)?.[1] ?? email).trim().toLowerCase();
  return PLACEHOLDER_EMAIL_DOMAINS.some((domain) => address.endsWith(domain));
}
