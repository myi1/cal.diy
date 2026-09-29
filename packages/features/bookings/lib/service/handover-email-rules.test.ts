import { describe, expect, it } from "vitest";

import { withHandoverEmailRules } from "./RegularBookingService";

describe("withHandoverEmailRules", () => {
  it("switches off only the lead's confirmation for a handover booking", () => {
    const result = withHandoverEmailRules({ disableStandardEmails: { all: { host: false } } }, { hub_handover: "true" });
    expect(result?.disableStandardEmails?.confirmation?.attendee).toBe(true);
    expect(result?.disableStandardEmails?.confirmation?.host).toBeUndefined();
    expect(result?.disableStandardEmails?.all?.host).toBe(false);
  });

  it("changes nothing for an ordinary booking", () => {
    const meta = { disableStandardEmails: { confirmation: { attendee: false } } };
    expect(withHandoverEmailRules(meta, { hub_call_id: "x" })).toBe(meta);
    expect(withHandoverEmailRules(undefined, undefined)).toBeUndefined();
    expect(withHandoverEmailRules(meta, { hub_handover: "false" })).toBe(meta);
  });
});
