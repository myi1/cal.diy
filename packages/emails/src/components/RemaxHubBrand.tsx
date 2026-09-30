import { WEBAPP_URL } from "@calcom/lib/constants";

// remaxhub: REMAX Hub house style for Cal's emails (as in the hours-drop email and the Hub PDFs).
export const BRAND = {
  red: "#DC1C2E",
  blue: "#003DA5",
  ink: "#16181D",
  body: "#2B2F38",
  muted: "#646C7A",
  rule: "#DFE3EA",
  soft: "#F5F7FA",
  font: "'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif",
};

/** Red/blue accent bar and the REMAX Hub mark, at the top of the email card. */
export const RemaxHubHeader = () => (
  <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse" }}>
    <tbody>
      <tr>
        <td style={{ padding: 0, lineHeight: 0, fontSize: 0 }}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
            <tbody>
              <tr>
                <td width="38%" style={{ height: "6px", background: BRAND.red, borderTopLeftRadius: "6px" }} />
                <td style={{ height: "6px", background: BRAND.blue, borderTopRightRadius: "6px" }} />
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style={{ padding: "22px 28px 6px" }}>
          <img
            src={`${WEBAPP_URL}/emails/remax-hub-logo.png`}
            width={120}
            alt="REMAX Hub"
            style={{ display: "block", width: "120px", height: "auto", border: 0 }}
          />
        </td>
      </tr>
    </tbody>
  </table>
);

/** Quiet footer under the card. */
export const RemaxHubFooter = () => (
  <div
    style={{
      margin: "0px auto",
      maxWidth: 600,
      padding: "16px 12px 32px",
      textAlign: "center",
      fontFamily: BRAND.font,
      fontSize: "12px",
      lineHeight: "18px",
      color: BRAND.muted,
    }}>
    REMAX Hub · Dubai ·{" "}
    <a href="https://remaxhub.ae" style={{ color: BRAND.muted, textDecoration: "underline" }}>
      remaxhub.ae
    </a>
  </div>
);
