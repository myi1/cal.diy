import { filterReqHeaders, redactAuthorization, summarizeBody } from "./filterReqHeaders";

describe("filterReqHeaders", () => {
  it("never returns the API key from the Authorization header", () => {
    const filtered = filterReqHeaders({
      authorization: "Bearer cal_live_0123456789abcdef",
      "cal-api-version": "2024-08-13",
    });
    expect(filtered.Authorization).toBe("Bearer [REDACTED]");
    expect(JSON.stringify(filtered)).not.toContain("cal_live_0123456789abcdef");
    expect(filtered["Cal-Api-Version"]).toBe("2024-08-13");
  });

  it("redacts a bare token with no scheme", () => {
    expect(redactAuthorization("cal_live_0123456789abcdef")).toBe("[REDACTED]");
  });

  it("leaves a missing Authorization header missing", () => {
    expect(filterReqHeaders({}).Authorization).toBeUndefined();
  });
});

describe("summarizeBody", () => {
  it("logs only top-level keys and size, not lead details", () => {
    const summary = summarizeBody({
      attendee: { name: "Jane Buyer", email: "jane@example.com", phoneNumber: "+447700900123" },
      start: "2026-10-01T09:00:00Z",
    });
    expect(summary).toMatch(/^\{keys: attendee,start; bytes: \d+\}$/);
    expect(summary).not.toContain("jane@example.com");
    expect(summary).not.toContain("+447700900123");
  });

  it("does not log tokens in a response body", () => {
    const summary = summarizeBody({
      status: "success",
      data: { accessToken: "secret-access", refreshToken: "secret-refresh" },
    });
    expect(summary).not.toContain("secret");
  });

  it("handles empty, primitive and array bodies", () => {
    expect(summarizeBody(undefined)).toBe("{}");
    expect(summarizeBody("raw")).toBe("[string]");
    expect(summarizeBody([1, 2])).toMatch(/^\{keys: array\(2\); bytes: \d+\}$/);
  });
});
