import { IncomingHttpHeaders } from "node:http";

// remaxhub: logs must never carry credentials. Keep only the auth scheme ("Bearer") so a log still shows
// which kind of auth a request used.
export function redactAuthorization(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value.join(",") : value;
  const scheme = raw.trim().split(/\s+/)[0];
  return scheme && scheme !== raw.trim() ? `${scheme} [REDACTED]` : "[REDACTED]";
}

export function filterReqHeaders(headers: IncomingHttpHeaders): Partial<IncomingHttpHeaders> {
  return {
    "Content-Type": headers["Content-Type"] ?? headers["content-type"],
    Authorization: redactAuthorization(headers["Authorization"] ?? headers["authorization"]),
    "X-Cal-Client-Id": headers["X-Cal-Client-Id"] ?? headers["x-cal-client-id"],
    "Cal-Api-Version": headers["Cal-Api-Version"] ?? headers["cal-api-version"],
    "X-Request-Id": headers["X-Request-Id"] ?? headers["x-request-id"],
    "User-Agent": headers["User-agent"] ?? headers["user-agent"],
    "X-Forwarded-For": headers["x-forwarded-for"],
    "X-Forwarded-Host": headers["x-forwarded-host"],
    "CF-Connecting-IP": headers["cf-connecting-ip"],
    "CloudFront-Viewer-Address": headers["cloudfront-viewer-address"],
    "X-Vercel-Id": headers["x-vercel-id"],
    "X-Vercel-Deployment-Url": headers["x-vercel-deployment-url"],
    "X-Vercel-Country": headers["x-vercel-country"],
    "X-Vercel-Region": headers["x-vercel-region"],
    Host: headers["Host"] ?? headers["host"],
  };
}

// remaxhub: request and response bodies hold leads' names, emails and phone numbers, and OAuth tokens.
// Log their shape (top-level keys and size) instead of their values.
export function summarizeBody(body: unknown): string {
  if (body === undefined || body === null) return "{}";
  if (typeof body !== "object") return `[${typeof body}]`;
  try {
    const bytes = Buffer.byteLength(JSON.stringify(body));
    const keys = Array.isArray(body) ? `array(${body.length})` : Object.keys(body).join(",");
    return `{keys: ${keys}; bytes: ${bytes}}`;
  } catch {
    return "[unserializable]";
  }
}
