/**
 * Prove the GA4 read path end to end, with no dependencies.
 *
 * Signs a JWT with the service account key, exchanges it for a token, and asks
 * the Analytics Data API for the most-read pages of the last 28 days. If this
 * prints rows, the desk console can read article views.
 *
 * It never prints the key, and it never writes anything.
 *
 *   node scripts/check-ga4.mjs
 *
 * Reads GA4_CREDENTIALS_FILE (default E:\Balkaris\secrets\balkaris-desk-ga4.json)
 * and GA4_PROPERTY_ID (the NUMERIC property id, not the G-XXXX measurement id).
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const KEY_FILE = process.env.GA4_CREDENTIALS_FILE ?? "E:\Balkaris\secrets\balkaris-desk-ga4.json";
const PROPERTY = (process.env.GA4_PROPERTY_ID ?? "").trim();

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o))
  .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

if (!PROPERTY) die("Set GA4_PROPERTY_ID to the numeric property id (GA4 > Admin > Property Settings).");
if (/^G-/i.test(PROPERTY)) die(`GA4_PROPERTY_ID is "${PROPERTY}" — that is the MEASUREMENT id from the site tag.\n  The Data API wants the numeric PROPERTY id: GA4 > Admin > Property Settings > Property ID.`);

let key;
try {
  key = JSON.parse(readFileSync(KEY_FILE, "utf8"));
} catch (e) {
  die(`Cannot read the key at ${KEY_FILE}\n  ${e.message}`);
}
if (!key.client_email || !key.private_key) die(`${KEY_FILE} is not a service account key (no client_email / private_key).`);

console.log(`account   ${key.client_email}`);
console.log(`property  ${PROPERTY}`);

// 1. a signed assertion
const now = Math.floor(Date.now() / 1000);
const claim = {
  iss: key.client_email,
  scope: "https://www.googleapis.com/auth/analytics.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
};
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
const jwt = `${unsigned}.${signer.sign(key.private_key, "base64url")}`;

// 2. trade it for a token
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
});
const token = await tokenRes.json();
if (!tokenRes.ok) die(`Google refused the key (${tokenRes.status}): ${token.error_description ?? token.error ?? "no reason given"}`);

// 3. ask for the most-read pages
const reportRes = await fetch(
  `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ desc: true, metric: { metricName: "screenPageViews" } }],
      limit: 10,
    }),
  },
);
const report = await reportRes.json();

if (!reportRes.ok) {
  const msg = report?.error?.message ?? JSON.stringify(report);
  if (/has not been used in project|is disabled/i.test(msg))
    die(`The Analytics Data API is not enabled on that project yet.\n  ${msg}`);
  if (/permission|PERMISSION_DENIED/i.test(msg))
    die(`The key works, but it has no access to property ${PROPERTY}.\n  Add ${key.client_email} as a Viewer in GA4 > Admin > Property access management.\n  ${msg}`);
  die(`Analytics answered ${reportRes.status}: ${msg}`);
}

const rows = report.rows ?? [];
if (!rows.length) {
  console.log("\n✓ Access works — the API answered, but there are no page views in the last 28 days.");
  console.log("  Expected while the site is new, or if few visitors have accepted the cookie banner.\n");
  process.exit(0);
}
console.log(`\n✓ Access works. Most-read pages, last 28 days:\n`);
for (const r of rows) console.log(`  ${String(r.metricValues[0].value).padStart(7)}  ${r.dimensionValues[0].value}`);
console.log(`\n  Note: GA4 only fires after the cookie banner is accepted, so these undercount.\n`);
