# Slow-network playback (room-net.js + stream proxy + quality ladder)

**Deploy order:** 1) run `room-quality-schema.sql` in the Supabase SQL editor (after `nsfw-flag-schema.sql`)  2) deploy the site  (the site also works before step 1; X rooms then keep one quality, as before).

| Layer | File | What it does |
|---|---|---|
| Stream proxy | `api/browse.js` `proxyMediaStream` | keep-alive to the video host · 6 MB range slices (206) · browser-only cache · cancels upstream when the viewer leaves · one quiet retry · SSRF guard (literal IPs, DNS, redirects) · HLS playlist rewrite with correct cache headers |
| X import | `api/x.js`, `nova-home.html` `xMedia` | default file = sharpest up to 720p; the room also stores up to 5 qualities in `media.q` |
| Connection profile | `room-net.js` `profile()` | Network Information API + real stalls (3 in 2 min = slow) |
| HLS ladder | `room-net.js` `hlsConfig()` | slow: start lowest, climb slowly, deep buffer · fast: start high, capped to player size |
| File ladder (ABR) | `room-net.js` `abr()` | start rung from link + player size · speed measured from buffer fill · probe of the next rung before every step up · down = straight to the rung that fits · failed rung reverts · viewer can lock a quality (Video Quality menu) |
| Safety net | `room-net.js` `watch()` / `recoverError()` | frozen → nudge → restart same second → other route (direct ↔ proxy) · mid-video error retried with back-off |

Tests: `node tests/proxy-stream.test.js` · `node tests/net-unit.test.js` · `CLIP=… node tests/e2e-slow-playback.js` · `LOW=… HIGH=… node tests/e2e-abr.js` (clip recipes are in the test headers).
