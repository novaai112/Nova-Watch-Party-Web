# Nova — Home, Auth, Profile & Chat

Static website + Supabase, with Vercel serverless API routes. No build step; deploy the folder to Vercel.

## Files
| File | What it does |
|---|---|
| `config.js` | Public company info (also feeds the policy pages and Support page); Supabase config is loaded from `/api/config` |
| `7949.jpg` | Nova site favicon |
| `auth.css` | Shared sign-in loading and error screen |
| `mobile-navigation.js` | Mobile swipe navigation between Nova home and account/people tabs |
| `theme.js` | Light/dark theme (`data-theme`), used by login and profile |
| `translator.js` | On-demand translation of interface text and accessibility labels into 100+ languages |
| `index.html` | Sign up, log in, Google, forgot/reset password. Successful login opens `nova-home.html` |
| `nova-home.html` | Main Nova home, room list, search and platform picker |
| `profile.html` | Full profile, Settings, Language, Privacy + policies, Support, Social |
| `nova-core.js` | Shared: Supabase client, settings, haptics, auto-translate, languages. Load on **every** page |
| `nova-profile.js` | Profile sections: friends, videos, keywords, channels, interests, socials, preview, hide toggles |
| `nova-chat.js` | Mobile-first private direct/group chat, media, voice notes, mentions and realtime updates |
| `user_blocks` (in `chat-schema.sql`) | Username discovery, friends, recent conversations, requests and reciprocal blocking |
| `schema.sql` | Whole database (3 parts, safe to re-run) |
| `chat-schema.sql` | Repeatable database setup for private realtime chats and chat media |
| `local/local-search-server.js` | Token-protected laptop bridge for DuckDuckGo web searches |
| `api/x.js` | X (Twitter) post video detector: `/api/x?url=<post link>` returns whether the post has a video and its MP4/HLS address |
| `api/drive.js` | Google Drive checker: `/api/drive?url=` says if a file link is a playable video, `/api/drive?folder=` lists a shared folder |
| `api/twitch.js` | Twitch checker: `/api/twitch?url=` detects a channel / past video / clip, `?top=1` lists live channels, `?channel=` lists a channel's live status, videos and clips (no key needed) |
| `room-media.js` / `room-media.css` / `room-media-schema.sql` | Watch-room attachment picker (same as the friends chat, minus Contact and voice notes) and its database setup |
| `supabase/functions/chat-media-search/` | Authenticated Unsplash photo search plus GIPHY and KLIPY media search |

## 1. Database
Supabase Dashboard → SQL Editor → New query → paste **all of `schema.sql`** → Run.
It creates (Part 4 = username check, avatar bucket, gallery limits): `profiles` (+ settings), `gallery` (+ `gallery` storage bucket), `friendships`, `watch_history`, `support_tickets`, `subscriptions`, the views `public_profiles` and `map_users`, and the functions `public_profile`, `log_watch`, `set_like`, `delete_my_account`.

### Profile flow (new)
- After login, a user **without a username** is sent to a one-time **Set up your profile** screen (username required, photo optional). Nothing else in the profile opens until it is done.
- The username is checked live (format, reserved words, availability via `username_available`) and enforced again in the database, so two people can never get the same one.
- **Edit profile** (`profile.html#editprofile`): change photo (auto-cropped square, compressed, old file deleted), remove photo, name, username, country, bio (300 chars), **multi-photo gallery** (select many or drag & drop, max 30, compressed, per-photo delete), and **social links** (11 platforms + website; paste a handle or a full link).
- Photos go to two Storage buckets: `avatars` and `gallery` (both created by `schema.sql`).
- Re-run `schema.sql` once if you already ran an older version: Part 4 is safe to repeat.
- Run `chat-schema.sql` after `schema.sql` to enable direct and group conversations, message storage, Realtime publication, private media storage, and RLS.
- Run `rooms-schema.sql` after `schema.sql` to enable watch-party rooms, mic permissions, moderation actions, and public-room profile cards. Re-running it applies the room updates safely.
- Re-running `schema.sql` removes the obsolete room-invitation RPC and profile setting.

## 2. Auth settings (Dashboard → Authentication)
- **URL Configuration → Site URL:** `https://nova-watch-party.vercel.app/`
- **Redirect URLs:** add `https://nova-watch-party.vercel.app/**` and, for testing, `http://localhost:3000/**`
- **Providers → Email:** on. Keep "Confirm email" on for production.
- **Providers → Google (optional):** create an OAuth client in Google Cloud Console (type Web). Authorized redirect URI = the callback URL shown in Supabase's Google provider page. Paste Client ID + Secret in Supabase.

## 3. Deploy
Push the project folder to GitHub, then import that repository into Vercel. Use the repository root as the project root; this is a no-build static site with Node serverless functions under `api/`, configured by `vercel.json`. Do not set a static-only output directory, or the API routes will be omitted. Add the environment variables listed below before deploying. Keep `.env.local` out of GitHub. For local preview, run `node dev-server.js` and open its HTTP address; do not open HTML files directly with `file://`.
Flow: `index.html` → `nova-home.html` → Settings gear → `profile.html`. The home and account pages check the Supabase session before showing the app and redirect logged-out visitors to login, returning them to their original app page after sign-in. These browser guards improve navigation but do not replace Supabase Row Level Security; never rely on a static page redirect to protect database or API data.

## 4. Connect your video / chat pages
Add to each page: `config.js`, the supabase-js script, `nova-core.js` (and `nova-profile.js` on the player page).

```js
// when a user plays a video (builds Videos / Keywords / Channels / Interests / Watch time)
Nova.logWatch({ url, title, thumb, source: 'youtube', channel, nsfw: false, seconds: 0 });
Nova.setLike(url, true);                         // like / unlike

// incoming chat message (Auto-translate: returns English only if ON and message isn't English)
text = await Nova.tr(text);

// video element: Mute When Other Audio Plays
Nova.audioRule(videoElement);

// Floating Video Player: read Nova.S.floating and enable/disable Picture-in-Picture
// Quick Reaction (double-tap): send Nova.S.quick
// Haptic: automatic on every tap when ON
// map: read the view `map_users` (users with Hide Location ON are excluded)
```

## 5. How the settings behave
- **Hide Mature Content** is ON by default. Turning it off needs the "Enable 🔞 Mature Content" YES/NO confirmation. 18+ videos are only shown to people who turned it off.
- **Include 🔞 NSFW** (profile) works only when Hide Mature Content is off.
- **Profile 👁️ / 🙈** hides a section from other people. The database never sends hidden sections to others. **Preview** shows what others see.
- **Hide Location** is enforced by `map_users`.
- **Language:** English, Hindi, Spanish built in. Add one: copy a block inside `T` in `nova-core.js` and add it to `LANGS`.
- **Chat:** The chat fills the device viewport with the Friends/Recent/Request/Blocked rail and a Nova Home back control. The People list uses a mobile bottom navigation bar; an open thread keeps the navigation on the side. Search accepted friends by username, start one-to-one or group chats, exchange live messages, mention group/friend usernames, and send images, video, audio, documents, and contacts (up to 20 MB per file and 8 attachments per message). Attachments show a removable preview before sending; scrolling remains available while scrollbars are visually hidden. Voice notes support pause/resume, cancel, a three-minute limit, and playback preview before sending. The attachment menu includes files, camera, contacts, Unsplash photos with photographer attribution, GIPHY GIFs, transparent stickers, Clips with sound, animated Emoji, animated Text generated from the exact typed phrase, and KLIPY GIFs, stickers, Clips up to 10 seconds, Memes, and searchable AI Emoji. KLIPY content uses region-aware ranking and its high content filter; KLIPY Ads remain disabled. Clips attach as playable video with audio. Uploaded chat media is stored in the private `chat-media` bucket and signed links expire after one hour.
- **Nova home:** Signed-in users open `nova-home.html` after login. The settings gear opens the full Profile page; the floating + opens the platform picker. On phones, swipe left from Nova home to Settings/Profile and right to Friends; swipe left/right on the People screen to move among Friends, Recent, Request, and Blocked. The YouTube tile and Karaoke, Playlist, and Live sections show responsive, searchable results inside Nova, with channel/date details, likes, and YouTube’s official embedded player. YouTube’s complete website interface cannot be embedded as a page. Embedded playback requires Nova to be served from an HTTP(S) origin (not opened as `file://`). Search uses `YOUTUBE_API_KEY` from `config.js` before an older browser-saved key; **Change API key** stores an explicit local override, and **Use config.js key** retries without it. Restrict browser keys by website referrer and to the YouTube Data API v3 in Google Cloud Console.
- **In-app chat media search:** Unsplash, GIPHY, and KLIPY requests use the authenticated `supabase/functions/chat-media-search` Edge Function deployed to the Supabase project identified by the site's `SUPABASE_URL` (Vercel environment for production, `.env.local` locally). Add `UNSPLASH_ACCESS_KEY` and other provider keys in that project's Supabase Edge Function secrets; do not put them in browser code. GIPHY thumbnails load directly from its HTTPS CDN; KLIPY thumbnails also load directly from its HTTPS CDN, with the same-origin `/api/media-preview` route (KLIPY hosts only) as a fallback. Unsplash results use the returned image URLs, include photographer/Unsplash credit, and call Unsplash's download-tracking endpoint before the message is sent. The Unsplash Secret Key is not needed for photo search. GIPHY Clips require endpoint approval; Emoji and animated Text use the GIPHY SDK, and animated Text needs a GIPHY SDK key. KLIPY requests pass the browser locale and use `content_filter=high`; ads are off, and the public KLIPY API does not document Mini Games.
- To deploy the function, verify `npx supabase projects list` succeeds, then run `npx supabase functions deploy chat-media-search --remote=<project-ref>` for the project configured by `SUPABASE_URL`. If the CLI reports `401 Invalid access token`, remove any stale `SUPABASE_ACCESS_TOKEN` environment override and re-authenticate with `npx supabase login`; do not put access tokens in source files or share them in chat.
- **People:** The Friends page has Friends, Recents, Requests, and Blocked tabs. Recents lists every other profile from your latest direct and group conversations. Username search shows each result's friend/request/blocked state. Blocking removes the friendship and pending requests, prevents new requests and conversations in either direction, and hides shared conversation history from both users. Unblocking does not restore a friendship.
- **Watch-party rooms:** Member photos open their profiles; right-click (desktop) or long-press (mobile) opens friend, mute, block, report, and admin-only kick actions. Admin avatars have a gradient ring. Public rooms allow all members to use voice when enabled; non-public rooms require admin approval per member. Kicked members can return only after the admin invites them again. The active video title appears in its chat “Now playing” card, where YouTube videos can be liked; the duplicate title row below playback controls is removed. A user's public active room appears on their profile as a tap-to-join card with the current video and a horizontally scrollable row of member avatars. Room block/report actions use `chat-schema.sql` and the latest `rooms-schema.sql`; reports are stored privately in `room_reports`.

## 6. Test checklist (use two accounts)
1. Sign up, confirm email, log in → Nova home opens. Use the gear to open Profile.
2. Settings: change Quick Reaction, tick/untick every switch, reload — values persist.
3. Add a friend by username on account A; accept on account B; both show friend bubbles.
4. Call `Nova.logWatch(...)` for a few videos; check Videos, Keywords, Channels, Interests.
5. Hide a section on A, open A's profile from B — it is gone.
6. Contact us creates a row in `support_tickets`. Delete Account (type DELETE) removes the user.
7. After running `chat-schema.sql`, search users by username; test friend requests, the Friends/Recents/Requests/Blocked tabs, block/unblock and verify blocked users cannot request or open shared chats.
8. Accept a friend request on two accounts, exchange messages, and verify updates arrive without refreshing. Test group creation, @username suggestions, document/photo/video/audio uploads, contact sharing, camera capture, and microphone permissions. Verify incoming bubbles remain left-aligned and outgoing bubbles right-aligned with the chat surface transparent.
9. Search Unsplash photos and send one; verify the photographer and Unsplash links appear in the picker and shared message. Test GIPHY GIFs/stickers/Clips/Emoji/animated Text and KLIPY GIFs/stickers/Clips/Memes/AI Emoji; verify clips play with sound and results arrive for the other member through Realtime. Deploy the `chat-media-search` Edge Function and configure the required provider keys and GIPHY Clips access.
10. After running `rooms-schema.sql`, create a private room with two accounts. Confirm the guest mic is blocked until the admin enables it in People, then revoke access and verify the mic turns off. Test avatar click, right-click/long-press actions, friend/mute/block/report, and admin-only kick; confirm the kicked account cannot rejoin until the admin invites it again.
11. Create a public room and verify member avatars replace the Nova wordmark while mics are active, the admin has a gradient ring, and another member's profile shows a tap-to-join card with a horizontally scrollable row of all room members.

## 7. Notes
- The anon key served to the browser through `/api/config` is meant to be public. Never put the `service_role` key in any file here.
- Auto-translate uses an unofficial Google endpoint. Use a paid translation API for production.
- Deleting an account removes database rows. Uploaded gallery files stay in Storage; remove the `<user id>/` folder in Dashboard → Storage if needed.
- The Privacy, Data and Terms pages are generated from `config.js`. They are a good starting point, not legal advice — have a lawyer review them before launch.
- Not built: Friends "Trending" tab and payments (the plan badge reads `subscriptions`, which your payment webhook should fill).

## 8. Update: new account pages + gallery fix
- **Run `fix-gallery-permissions.sql` once** (Supabase -> SQL Editor). It fixes `permission denied for table gallery` (and the same missing grants on friends, history, support and plan tables). It is also appended to `schema.sql` as Part 5.
- Login goes straight to `nova-home.html`; the profile is opened from its settings gear.
- `profile.html` is now a My Account area: Profile Info, Account Stats, Gallery, Friends, Social, Settings, Language, Support, Notification, Watch Activity, Privacy & Data. Desktop = sidebar, phone = list + bottom nav.
- Profile Info shows photo, name, username, email and bio only. Edit opens as a popup on every device. Social links have their own popup.
- Security Settings has popup flows for changing the signed-in user's password and confirming account deletion. Language and Privacy & Data remain separate destinations rather than duplicate Settings rows.
- The gallery uses a compact add-photo tile when it already contains photos; the upload drop zone is shown only while the gallery is empty.
- The language picker offers 100+ language codes. Selected interface text is translated on demand through MyMemory's public endpoint and cached in the browser; email addresses, names, bios, and other marked personal content are excluded. Public translation services can rate-limit requests or have incomplete language support, in which case the original text remains visible with a notice.
- The language picker has an in-page search across language names and codes.
- Language search also matches normalized accented text and the browser's English/native language display names when available; filtering happens immediately across the complete language list.
- Chat requires `chat-schema.sql` to be run in Supabase after `schema.sql`. It uses accepted friendships, Row Level Security, a private media bucket, and Supabase Realtime; browser microphone access requires HTTPS or localhost. Database-backed realtime behavior requires a configured Supabase project and two signed-in accounts.
- `HOME_URL` in `config.js` points the profile's back/home controls to `nova-home.html`.

## Video search & import (server functions)
YouTube search, pasted links and "video from any web page" run through `/api/*` serverless functions, so visitors never enter or see an API key.
- These features require the site to be served by Vercel (or another host configured to run the `/api` functions); opening `nova-home.html` as a local file or hosting only static files will not work. Local testing: copy `.env.local.example` to the ignored `.env.local`, fill in the values, and run `node dev-server.js`.
- `api/youtube.js` — YouTube Data API proxy (search with endless scrolling, link lookup). **Needs the env var `YOUTUBE_API_KEY`.**
- `api/extract.js` — finds the playable video on a web page (mp4/webm/m3u8, `<video>`, og:video, JSON-LD, YouTube/Vimeo/Dailymotion embeds) and imports only the video. DRM sites (Netflix, Prime, Disney+) cannot be imported.
- `api/websearch.js` — plain web search for the Web tab.
- `nova-add.js` — client helpers: confirm popup (Add / Cancel), multi-video chooser, link parsing.

**Setup:** In Vercel → Project → Settings → Environment Variables, add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `YOUTUBE_API_KEY` as separate variables for each environment you deploy. If using the built-in Google search fallback, also add `GOOGLE_API_KEY` and `GOOGLE_CX`. Mark Google and YouTube API keys Sensitive, then redeploy. The Supabase URL and anon key are public client configuration; never use a Supabase service-role key. Restrict Google keys to the required APIs. Do not put API keys in `config.js` or any browser file.
**Local test:** copy `.env.local.example` to `.env.local`, fill in the values, and run `node dev-server.js`. Never commit `.env.local`.

### DuckDuckGo search from Vercel using your laptop
Vercel may receive no results when its own servers request DuckDuckGo. This optional bridge keeps the site and `/api` routes on Vercel while sending only search requests to a small, token-protected service on your Windows laptop. Search results still use Nova's existing result page and video detection flow.

1. Generate a random token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set `DDG_BACKEND_TOKEN` to that value in the ignored `.env.local`.
2. Keep the laptop-only service in `local/` and run `node local/local-search-server.js`. The `local/` folder is Git-ignored so it is not pushed to GitHub or deployed to Vercel; the service reads `.env.local` from the project root. It listens only on `127.0.0.1:3011` and exposes the authenticated `/search` endpoint.
3. Install and authenticate ngrok, then run `ngrok http 3011`. Keep both terminals and the laptop online. Copy the HTTPS forwarding URL ngrok prints.
4. In Vercel Production Environment Variables, set `LOCAL_DDG_BACKEND_URL` to that URL plus `/search` (for example, `https://your-ngrok-host.ngrok-free.app/search`) and set `DDG_BACKEND_TOKEN` to the same token. Redeploy.
5. Test `https://your-production-domain/api/websearch?q=song`; a successful response reports `engine: "duckduckgo"`. The `/api/browse?q=...` page uses the same bridge. Chat photo search uses Unsplash through the Supabase Edge Function and does not use this bridge.

The laptop and ngrok tunnel must stay running for Production DuckDuckGo search. If ngrok gives you a different URL after restart, update `LOCAL_DDG_BACKEND_URL` in Vercel and redeploy. If DuckDuckGo blocks or rate-limits the laptop's network, this local scraper may also stop returning results; the bridge does not bypass those restrictions.

### In-app browser (Web tab)
Search the web (or type an address) and pages open **inside Nova** through `api/browse.js`. Website JavaScript runs in an isolated sandboxed iframe. Nova detects accessible HTML5 video sources (MP4/M4V, WebM, Ogg, and HLS), dynamically added video elements, and direct HTTPS video links; it asks **Add / Cancel** only after you tap a player or video link. Only the selected video goes to the room, never the website. YouTube search results are offered directly for the official synced room player instead of opening a blank proxied YouTube watch page.
- Safety: page fetches use the same SSRF guard as `api/extract.js` (no localhost / private networks / cloud metadata). The iframe has an opaque origin with no access to Nova's login or storage, and cannot open pop-ups, download files, or navigate the top-level page. Site scripts can still make HTTPS/WSS requests; browser CORS and site restrictions still apply.
- Limits: this sandbox is not a full browser. Site sign-in, cookies, downloads, pop-ups, nested cross-origin players, or some media features may not work. Pages still loading after 12 seconds show retry and open-original options instead of an indefinite spinner. YouTube's full homepage requires its own browser cookies, so open it with "Open original website"; use Nova search or a direct video link to add videos. DASH manifests and protected, account-bound, or paywalled streams are not supported; Nova does not bypass site access controls. The Node server adds OS-installed CA certificates to Node's trusted roots where supported, while keeping certificate verification enabled. Untrusted self-signed certificates remain blocked; install the issuing CA in the server's system trust store or set `NODE_EXTRA_CA_CERTS` to its PEM file before starting Node. Nova can sync only direct secure video links and officially embeddable players.


## X (Twitter) videos
Platform picker -> **X** has two options:
1. **Paste X Post Link** — paste a post link (checked automatically on paste). `/api/x` looks the post up; if it has a video (or GIF) a popup asks *Add this X video to the room?* Yes adds only the video and plays it, No closes. Posts without a video, deleted or private posts show a clear message.
2. **Continue to Website** — X inside Nova: Sign in / Sign up (opens x.com's own secure window — X does not allow its login to be embedded or proxied), open any profile's posts with X's official embedded timeline, tap a post and the same popup appears if it has a video. A paste box is always there as a fallback.
Any X link pasted in the YouTube box, Web box or in-app browser is routed through the same detector.
No new environment variables and no database change. `vercel.json` already covers `api/*.js`.

## Google Drive videos
Platform picker -> **Drive** has two options:
1. **Paste Drive Link** — paste a video link (checked automatically) or a shared-folder link (browse sub-folders, tap a video). Popup: *Add this Drive video to the room?* Yes adds and plays it.
2. **Continue to Drive** — Google sign-in + Google's own file picker inside Nova (Drive's website itself cannot be embedded). Pick a video; if it is private Nova asks before setting it to "Anyone with the link" so the whole room can watch. Needs `GOOGLE_CLIENT_ID` and `GOOGLE_PICKER_API_KEY` (see `.env.example`; enable Google Picker API + Drive API, add your site as an authorised JavaScript origin). Without them the panel still offers Open Drive and the paste box.
Files must be shared "Anyone with the link". MP4/WebM/MOV play in sync; MKV/AVI or download-disabled files fall back to Drive's own player (not time-synced). Folder listing and video lengths use `DRIVE_API_KEY` (Drive API enabled); single-file detection works without any key.


## 6. Google Drive sign-in: "Error 403: access_denied" (fix)
"Continue to Drive → Choose from my Google Drive" uses Google sign-in. If Google shows *Access blocked: … has not completed the Google verification process*, your OAuth app is still in **Testing** mode, where only listed test users may sign in.
1. Google Cloud Console → **APIs & Services → OAuth consent screen** (Google Auth platform → Audience).
2. Press **Publish app** → status **In production**. Nova only requests `https://www.googleapis.com/auth/drive.file` (non-sensitive), so no Google review is required.
3. Under **Credentials → your OAuth client → Authorized JavaScript origins**, add `https://nova-watch-party.vercel.app`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_PICKER_API_KEY` in Vercel, enable the **Google Picker API** and **Google Drive API**, redeploy.
(Quick alternative: keep Testing mode and add each person under *Test users*.) Pasting a Drive link always works without any sign-in.

## 7. X and Twitch in rooms
Both have the same two options, ending in one "Add to room?" popup:
- **Paste link** - detects the video and asks before adding.
- **Continue to Website** - X: type a profile and tap one of its video posts (Nova's own list via `/api/x?user=`, since X's embedded timeline no longer loads reliably). Twitch: live channels, or open a channel for its past broadcasts and clips.
Twitch plays in Twitch's official player (`parent` is set to your site's host name automatically); it is shared but cannot be time-synced.

## 8. Watch-room attachments
The room message bar has the same paperclip menu as the friends chat: Document, Photos & videos, Camera, Audio, Unsplash, GIPHY, KLIPY (voice notes are not duplicated: the room already has its mic). Run **`room-media-schema.sql`** once in the Supabase SQL Editor (after `rooms-schema.sql`): it adds `room_messages.attachments`, allows attachment-only messages, and creates the private `room-media` bucket (members of the room can read, you can only upload to your own folder). Until it is run, text chat keeps working and attaching a file shows a hint. The Contact option was removed from the friends chat, and its GIPHY entry is now just "GIPHY".


## 18+ age assurance (Hide Mature Content)
Turning **Hide Mature Content** off for the first time opens `age-verify.html`: camera consent → 4 random liveness moves (blink, wink, head turn, smile …, each shown as an orange/green/red ring) → server decision. Only after success is `profiles.maturity_verified` set (by the server, never the browser) and the toggle turned off. Verified users switch it on/off freely with no new check. A database trigger keeps Hide Mature ON for unverified accounts, and `public_profile()` only returns NSFW videos to verified users.

**Setup**
1. Re-run `schema.sql` (Part 6 adds `maturity_verified`, the gate trigger and the one-time `age_sessions` table).
2. Vercel env vars: `SUPABASE_SERVICE_ROLE_KEY` (server only, never expose), plus an age provider:
   - Production: `AGE_PROVIDER=http`, `AGE_PROVIDER_URL`, `AGE_PROVIDER_SECRET`. The provider receives one JPEG frame and must reply `{ref, ts, result: 'adult'|'minor'|'uncertain', signature}` with `signature = HMAC-SHA256(secret, ref.result.ts)` (hex). Wrap a certified vendor (ISO/IEC 30107-3 tested PAD + age estimation) in a small adapter that speaks this.
   - Local testing only: `AGE_PROVIDER=dev` approves anyone who passes the liveness moves; it is refused when `VERCEL_ENV=production`.
   - No provider configured = verification fails closed ("service unavailable").
3. Camera needs https (or localhost). The face model loads from jsDelivr/Google storage (MediaPipe Face Landmarker) — self-host it if you need a strict CSP.

**Honest limits:** the browser checks (movement, quality, frozen/virtual-camera hints) raise the bar but cannot prove the stream is not injected or deep-faked, and the page does not claim ISO/IEC 30107-3 compliance. That assurance must come from the provider. Head-pose/blink thresholds are in `liveness-engine.js` (`CFG`); open `age-verify.html?debug=1` to see live values when tuning on real devices.

**Tests:** `node tests/liveness-engine.test.js`, `node tests/age-api.test.js`, and `node tests/e2e-age-verify.js` (Playwright, stubbed face model).
