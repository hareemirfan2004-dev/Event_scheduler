# Security Vulnerabilities — Saath Scheduler

> Source: an external security-headers check against the deployed site
> (`event-scheduler-vert.vercel.app`). Recorded 2026-07-24.

## Missing security headers

### What was found
The check fetched `event-scheduler-vert.vercel.app`, looked at the response headers, and found **4 of the 5 core security headers missing**. This is a **low-severity hardening gap**, not a compromise: the site is missing headers that browsers use to reduce attack surface. (The 5th, **HSTS**, *is* present — Vercel adds it.)

### What each missing header does

| Header | What it protects against |
|---|---|
| **Content-Security-Policy (CSP)** | The big one: controls which scripts/styles/images the browser is allowed to load. It's the main defense against **XSS / script injection**. Missing = if malicious script gets onto a page, nothing stops it running. |
| **X-Frame-Options** | Stops your page from being embedded in an `<iframe>` on another site → defends against **clickjacking** (tricking users into clicking hidden UI). Missing = your app can be framed by a malicious page. |
| **X-Content-Type-Options: nosniff** | Stops the browser from "MIME-sniffing" (guessing a file's type). Missing = the browser may execute a non-script file as a script → a **content-injection** vector. |
| **Referrer-Policy** | Controls how much of your URL is leaked in the `Referer` header when a user clicks away. Missing = full URLs (possibly with sensitive query params) can leak to third-party sites. |

### How to fix (this is a Next.js app)
Add the 4 headers via the `headers()` function in **`next.config.ts`** (the Next.js-idiomatic way; a `vercel.json` `headers` block also works on Vercel). A hardened starting point — merge this into `next.config.ts` (verified against the installed **Next.js 16.2.10** `headers()` API):

```ts
import type { NextConfig } from "next";

// Security headers on every response — addresses the missing-headers
// finding documented above.
const securityHeaders = [
  // Clickjacking: don't allow the app to be framed by other origins.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop the browser from MIME-sniffing responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Limit how much URL info leaks to third parties on navigation.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // CSP starts in REPORT-ONLY so it logs violations WITHOUT breaking the app.
  // Tune from the reports, then rename the key to "Content-Security-Policy"
  // to enforce (see rollout notes below).
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

**Rollout notes:**
- **The 3 non-CSP headers are safe to enforce immediately** — they clear the X-Frame-Options / X-Content-Type-Options / Referrer-Policy findings.
- **CSP is intentionally `-Report-Only`** so it won't break the app on day one. Header checkers typically still count a Report-Only CSP as missing until it's enforced. That's the deliberate trade: an enforced CSP that blocks your own scripts is worse than one open finding.
- **To enforce:** watch the browser console / CSP violation reports, tighten the policy to only what Saath actually loads (drop `'unsafe-inline'`/`'unsafe-eval'` — ideally move to a **nonce-based CSP** via middleware, the strongest form), then rename the key `Content-Security-Policy-Report-Only` → `Content-Security-Policy`.
- **HSTS** is not in the snippet — Vercel already sets it, so no action needed.
- If Saath loads **external resources** (Google Fonts, analytics, a CDN, an image host), add their origins to the matching `*-src` directive — otherwise Report-Only will flag them (and enforcing later would block them).
- `X-Frame-Options` is `SAMEORIGIN` (allows your own pages to frame themselves); use `DENY` if nothing in Saath is ever framed.
