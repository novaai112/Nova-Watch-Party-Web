# PRD · F1 — Sync Engine v2 (P0)

| | |
|---|---|
| **Product** | Nova Watch Party |
| **Feature** | F1 · Sync Engine v2 |
| **Priority** | P0 |
| **Status** | Implemented in v15 (this package) |
| **Code** | `room-sync.js` (engine), `room.js` (integration), `room-sync.css`, `rooms-schema.sql` (wait mode, telemetry, metrics view) |
| **Tests** | `tests/sync-engine.test.js`, `tests/room-sync-test.sql`, `tests/e2e-room-sync.js` |

## 1. Problem
On slow networks members drift by seconds, one member's buffering desyncs the whole room, and nobody knows who is behind.

## 2. Goals / non-goals
**Goals** — keep every member within 1 s of the host; make stalls visible and (optionally) shared; recover from network loss without a refresh; measure all of it.
**Non-goals** — changing the host-as-reference model; syncing live streams or embed-only platforms (no timeline / no player control); voice sync.

## 3. Requirements and how they are met
| # | Requirement | Implementation |
|---|---|---|
| R1 | Continuous drift correction: off by > 1.5 s → nudge playback rate (0.95×–1.05×) before hard-seeking; hard-seek only above 4 s | `decide()` / `E.correct()` run every second for members. Nudge = 0.95×/1.05× of the room speed; released when within 0.4 s (hysteresis). Hard seek only > 4 s, followed by a 1.5 s settle window. **Seek guard:** ≥ 5 s between automatic seeks, ≤ 3 per 30 s, none while buffering. |
| R2 | Buffering awareness: member buffering > 3 s → "Waiting for {name}"; optional pause for all (admin setting *Wait for everyone / Never wait*) | Each client broadcasts its status (`sync` event) on change and every 3 s. `waitTarget()` picks the longest buffering member (> 3 s; ignores new joiners' first 15 s, stale reports > 12 s, self). Admin pauses/resumes for everyone in *Wait for everyone* (resume 0.8 s after the member returns, **hard cap 20 s per stall**, admin pressing play overrides). *Never wait* only shows "{name} is buffering". Setting: `rooms.wait_mode`, `room_update(p_wait_mode)`, Room settings → *Playback sync*. |
| R3 | Per-member sync badge (In sync / Behind / Buffering) in the People list | `syncBadge()`; also **Ahead**. Badge disappears when a member is silent > 12 s. |
| R4 | Late joiner lands at the live position with a Catch up button and a 3-2-1 resync option | Join/return seeks to the live position; pill "Live position · Catch up · 3-2-1 resync" for 10 s; "Behind/Ahead x s" pill (after 4 s of lasting drift) carries the same buttons. 3-2-1 parks the player where the room will be when the countdown ends, then plays on 0. |
| R5 | Automatic reconnect with exponential back-off, restoring role, mic state and position | `netDown/reconnect/netUp`: 1, 2, 4, 8, 16, 30 s (±20 %), triggered by browser offline, failed heartbeat, channel error/timeout/close. Immediate retry on `online` and on tab refocus. Success = channel really SUBSCRIBED + heartbeat OK; swept members re-join (`join_room`). Restores role (re-read from server), members/queue/chat, mic announcement, player position (members → live position; admin re-publishes). |
| R6 | Server clock offset every 30 s and on tab refocus | `syncClock(n)`: n samples, lowest round trip wins, < 25 ms ignored, ≤ 400 ms smoothed, larger applied at once, RTT > 3 s ignored. 3 samples on join/refocus/reconnect, 1 every 30 s. |

## 4. Acceptance criteria
| Criterion | Status |
|---|---|
| 95 % of members within 1 s of the host over a 30-min test on throttled 3G | **Needs a field run** (see §6). The control loop, thresholds and telemetry (`p95_drift`) are in place; the e2e suite proves the loop converges (2.2 s → < 0.6 s without a seek). |
| After a 20 s network drop the member rejoins without a manual refresh | **Met** (`e2e-room-sync.js` §F). Browser offline → back at the `online` event. Server-side outage with the browser still online → next back-off attempt (attempts at ≈ 1, 3, 7, 15, 31 s, so up to ~11 s after the drop ends). |
| No double-seek loops (regression in the e2e suite) | **Met** (`sync-engine.test.js` + `e2e-room-sync.js` §B): a player that ignores seeks for 2 min gets ≤ 12 seeks, ≥ 5 s apart, ≤ 3 per 30 s; a stall is never "seeked". |

## 5. Metrics
Clients send a `room_sync_report` summary about once a minute and after each reconnect (stored as `sync_stats` in `room_playback_log`). View `room_sync_metrics_daily` (operators only):
| Metric | Column |
|---|---|
| Median drift | `median_drift_s` (+ `p95_drift_s`) |
| Desync complaints per 1,000 sessions | `desync_actions_per_1000` — manual Catch up / 3-2-1 presses per 1,000 member-sessions (proxy for complaints) |
| Reconnect success rate | `reconnect_success_rate` = recovered / episodes |

## 6. Rollout, risks, limits
* **Deploy:** re-run `rooms-schema.sql` (idempotent; adds `wait_mode`, new `room_update` signature, `room_sync_report`, the metrics view). Ship `room-sync.js`, `room-sync.css`, `room.js`, `nova-home.html` together. Old clients keep working; they just show no badge.
* **YouTube** only offers fixed rates, so a "nudge" is the next step (e.g. 1.25×/0.75×) instead of ±5 %; the hysteresis keeps overshoot under ~0.3 s. Plain `<video>`/HLS use true 0.95×/1.05×.
* **Live streams and embeds** are excluded from drift correction.
* **Trust model:** `sync` broadcasts are unauthenticated like the existing `kick`/`rate` events; the client only accepts reports from current members and the wait is capped at 20 s, so abuse is limited to a short pause.
* **Reconnect metric bias:** episodes that never recover cannot report, so the success rate is an upper bound; pair it with room-member sweep counts.
* **Field validation still required:** the 95 %-within-1 s criterion on a throttled 3G profile (e.g. Chrome DevTools "Slow 3G"/Network Link Conditioner, 2+ members, 30 min) and mic restore after reconnect on real devices.

## 7. Test matrix
| Suite | Command | Result |
|---|---|---|
| Engine unit tests (84) | `node tests/sync-engine.test.js` | pass |
| Server (wait mode, telemetry, metrics, no overload) | `psql -f tests/mock-supabase.sql -f rooms-schema.sql -f tests/room-sync-test.sql` | pass |
| Browser e2e (43, virtual clock) | `node tests/e2e-room-sync.js` | pass |
