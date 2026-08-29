# CheetCode v3 `speed_demon` timing investigation

Date: 2026-08-28. Account used for live writes: `trimaxeng2` only.

## Verdict

No client-side transport trick tested here caused the v3 `speed_demon` bonus. A warm HTTP/2 connection reduced client round-trip time, but the server still scored the run with 1–2 seconds of elapsed time. The decisive run sent the honest app-style elapsed value, solved all 25 problems, and still returned `timeRemaining: 58`, ordinary `speedBonus: 20`, and no `speed_demon` exploit.

The strongest observable conclusion is that the hidden gate is evaluated at the server's finish-scoring point, after enough finish processing has occurred to cross one second. The response does not expose a `finishReceivedAt` field, so the exact internal receive timestamp cannot be named from the public surface. The operational elapsed is:

```text
serverElapsed = server scoring timestamp - session.startedAt
speed_demon   = serverElapsed < 1000 ms
timeRemaining = floor((session.expiresAt - server scoring timestamp) / 1000)
```

`/api/session` returns `startedAt` and `expiresAt = startedAt + 60,000`; it does not return a separate `createdAt`. The browser bundle never replaces `startedAt` with another client anchor. The client-only body value is `ROUND_DURATION_MS - (expiresAt - Date.now())`; v3 does not use that value for the hidden gate.

## Reset tests

One live session was created, restored, replayed with `session_started`, replayed with `heartbeat`, and finished immediately:

| operation | client round trip | observation |
|---|---:|---|
| `/api/session` | 1,246 ms | 25 problems; server `startedAt`/`expiresAt` present |
| `/api/session/restore` | 566 ms | returned exactly the same `startedAt` and `expiresAt` |
| `/api/session/replay` (`session_started`) | 714 ms | `{ok:true}`; no timing fields |
| `/api/session/replay` (`heartbeat`) | 674 ms | `{ok:true}`; no timing fields |
| `/api/level-1/finish` | 1,811 ms | 25/25, `timeRemaining:56`, `speedBonus:19`, no hidden exploit |

The live bundle's restore effect only applies the returned session payload, replay is fire-and-forget telemetry, and the heartbeat only repeats replay every five seconds. None of these paths assigns a new `startedAt`.

## Browser HAR

`output/playwright/speed-demon-2026-08-28/browser-speed-flow.har` is a real headed Chromium capture using the supplied storage state. The flow solved all 25 catalog problems and used the authenticated browser fetch for finish. Relevant entries are HTTP/2.0 with DNS/connect/TLS all `-1` after connection reuse:

| request | total | TTFB/wait | result |
|---|---:|---:|---|
| `/api/session` | 1,637 ms | 1,424 ms | session `startedAt` returned |
| automatic `/api/session/replay` (`session_started`) | 912 ms | 911 ms | 200 |
| `/api/level-1/finish` | 1,219 ms | 1,219 ms | 25/25, `timeRemaining:57`, `speedBonus:19`, no hidden exploit |

The real app emits the `session_started` replay immediately after session state is applied. In this capture it overlapped the finish request; the finish request began about 1.06 seconds after the returned `startedAt`, so this particular browser attempt was already over the threshold before server scoring.

## HTTP/2 comparison

Direct Node `http2.connect()` confirmed `alpnProtocol: "h2"` and reused one TLS connection. A cold H2 run and a GET-prewarmed H2 run both solved 25/25:

| run | start RTT | finish RTT | client finish-send minus returned `startedAt` | result |
|---|---:|---:|---:|---|
| H2 cold | 1,244 ms | 2,262 ms | 403 ms | `timeRemaining:58`, `speedBonus:20` |
| H2 GET-warm | 1,213 ms | 1,528 ms | 403 ms | `timeRemaining:58`, `speedBonus:20` |
| H2 GET-warm, honest elapsed body | 1,071 ms | 2,270 ms | 214 ms | `timeRemaining:58`, `speedBonus:20` |

The last row is the key bound: the request was sent only 214 ms after the server-stamped anchor as seen by the client, yet the server's integer `timeRemaining:58` puts its scoring timestamp in the interval `[startedAt + 1,000 ms, startedAt + 2,000 ms)`. Therefore connection warmth does not make this client's scored finish sub-second.

## Network versus processing

Repeated `curl -w` samples (HTTP/2, new curl process each time) gave:

| target | DNS | TCP connect | TLS | TTFB | total |
|---|---:|---:|---:|---:|---:|
| `ctf.firecrawl.dev/` | 3–28 ms | 10–35 ms | 57–87 ms | 314–355 ms | 340–735 ms |
| Convex leaderboard query | 2–4 ms | 15–16 ms | 36–47 ms | 324–967 ms | 324–967 ms |

The HAR shows API time dominated by TTFB/wait (1.22–1.42 s) with negligible response transfer. Thus the roughly two-second finish observations are principally server/API processing plus unavoidable request propagation, not DNS/TLS setup. HTTP/2 removes setup on subsequent calls but does not remove the server wait.

## Reproduction

Use the existing authenticated state and fingerprint hints; do not add prohibited headers or print raw problem text:

```bash
CHEETCODE_GITHUB=trimaxeng2 \
CHEETCODE_FINGERPRINT_HINTS_PATH=recon-output/safari-session-2026-08-28T0008/fingerprint-hints.json \
npx tsx scripts/speed-demon-investigation.ts

npx tsx scripts/http2-speed-flow.ts
```

The browser/HAR capture helper is `scripts/browser-speed-flow.ts`. The HAR contains authenticated cookies and should remain local.

## Limits

The v3 server implementation is private. Public bundle/source inspection can pin the client request shapes and the returned timestamp fields, but not the private variable name used for the finish scoring timestamp. The response-derived 1–2 second bound is nevertheless sufficient to prove that no tested high-latency client technique achieved the `<1s` gate. The leaderboard's `timeSecs: 0` is integer-quantized and does not reveal the hidden sub-second timestamp.

A follow-up bounded campaign (maximum five H2 attempts, 6.5-second spacing, replay/heartbeat disabled) was started after the earlier probes. Its first finish was immediately rejected with HTTP 429, so it stopped without retrying. A later single-attempt retry was also immediately rejected with HTTP 429; no further live writes were made.

After the lockout cleared, one final single-session H2 attempt completed without 429 (`start` 3,084 ms, `finish` 1,413 ms), but the server scored it `0/25`, `timeRemaining:58`, score `0`, with no hidden exploit. It therefore supplies no additional positive speed evidence and was not retried.

## One-submission probe (2026-08-28)

After warming the permitted Convex leaderboard query and issuing a harmless `GET /api/level-1/finish` (405), a single persistent HTTP/2 attempt on `trimaxeng2` submitted exactly one catalog solution. It returned `timeRemaining:59` and an `exploits` entry for `speed_demon`; finish RTT was 698 ms and the client gap from `session.startedAt` to finish send was 187 ms. The attempt nevertheless reported `solved:0/25` and `score:0` (no bankable speed score). This proves the hidden speed check can fire without a full solved set, but v3's scoring path does not award useful points for that partial payload. The next optimization target is therefore a full-validity payload whose server validation is cheaper or already cached.
