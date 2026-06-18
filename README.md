<div align="center">

# mailcraft

> Generate possible email addresses from personal information using common naming patterns, then check them against breach databases.

</div>

---

## Overview

mailcraft is an OSINT web tool for investigators and researchers. It combines personal details against common naming patterns across 24 email providers to generate candidate addresses, then verifies them with syntax, MX, disposable, and breach checks to surface the ones most likely to be real.

## Features

- **Pattern generation** — turns names, birth dates, nicknames, and postcodes into 100+ address patterns across 24 providers, each scored for relevance.
- **Wildcard search** — filter results with `*` (any characters) and `_` (single character).
- **Verification** — syntax, live MX lookup, disposable detection, and breach lookups (XposedOrNot, LeakCheck, optional Have I Been Pwned), plus account-existence probes.
- **Export and share** — copy to clipboard, download as CSV, or share a link that encodes the full session in the URL.

## How it works

Enter a first and last name plus any optional details (middle name, nickname, birth year, postcode, birthday). mailcraft builds candidate addresses and ranks each one by:

- **Commonality (35%)** — how often the pattern appears in real-world use.
- **Identifiability (45%)** — how uniquely the pattern points to the person.
- **Provider share (20%)** — relative popularity of the provider.
- **PII bonus** — extra weight when a pattern uses additional personal information.

Select any address to see its scoring breakdown and run verification. Each address passes through syntax validation (with provider-specific rules for Gmail, Outlook, Yahoo, iCloud, and others), an MX record lookup, a disposable-domain check, and breach-database lookups. Results are labelled by confidence — from confirmed (found in a breach) down to invalid — and any address found in a breach shows an exposure count.

## Notes

- Verification requests are spaced out to stay friendly to upstream APIs.
- The top 10 results can be checked at once, or every result sequentially with abort support.
- Nothing is stored server-side; all state lives in the shareable URL.

---

<div align="center">
  by <a href="https://notalex.sh">notalex.sh</a>
</div>
