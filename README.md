# Nova — Home, Auth, Profile & Chat

Static website + Supabase. No build step. Deploy the folder to Vercel (or any static host).

## Files
| File | What it does |
|---|---|
| `config.js` | Your Supabase URL/anon key + company info (also feeds the policy pages and Support page) |
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
| `supabase/functions/chat-media-search/` | Authenticated image/GIF search used by private chat |

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
Upload the folder to Vercel (or run `npx serve .` from the project folder locally and open the HTTP address it prints). Keep all files in the same folder. Do not open the HTML files directly with `file://`; YouTube embedded playback requires an HTTP(S) referrer.
Flow: `index.html` → `nova-home.html` → Settings gear → `profile.html`. If a logged-out user opens `profile.html`, they are sent to login.

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
- **Chat:** The chat fills the device viewport with the Friends/Recent/Request/Blocked rail and a Nova Home back control. The People list uses a mobile bottom navigation bar; an open thread keeps the navigation on the side. Search accepted friends by username, start one-to-one or group chats, exchange live messages, mention group/friend usernames, and send images, video, audio, documents, and contacts (up to 20 MB per file and 8 attachments per message). Attachments show a removable preview before sending; scrolling remains available while scrollbars are visually hidden. Voice notes support pause/resume, cancel, a three-minute limit, and playback preview before sending. The attachment menu includes files, camera, contacts, SearXNG Images & GIFs, GIPHY, and KLIPY. Uploaded chat media is stored in the private `chat-media` bucket and signed links expire after one hour.
- **Nova home:** Signed-in users open `nova-home.html` after login. The settings gear opens the full Profile page; the floating + opens the platform picker. The YouTube tile and Karaoke, Playlist, and Live sections show responsive, searchable results inside Nova, with channel/date details, likes, and YouTube’s official embedded player. YouTube’s complete website interface cannot be embedded as a page. Embedded playback requires Nova to be served from an HTTP(S) origin (not opened as `file://`). Search uses `YOUTUBE_API_KEY` from `config.js` before an older browser-saved key; **Change API key** stores an explicit local override, and **Use config.js key** retries without it. Restrict browser keys by website referrer and to the YouTube Data API v3 in Google Cloud Console.
- **In-app chat media search:** Deploy `supabase/functions/chat-media-search` to the Supabase project used in `config.js` with `supabase functions deploy chat-media-search`. Add `SEARXNG_BASE_URL` as a Supabase Edge Function secret/config value pointing to your HTTPS SearXNG instance, plus `GIPHY_API_KEY` and/or `KLIPY_API_KEY` for those optional providers. SearXNG does not require a Google/Yandex API key. Configure your SearXNG `settings.yml` to enable the desired image engines and allow JSON output under `search.formats`; the function requests `format=json` in the `images` category. Many public instances disable JSON or rate-limit shared traffic. SearXNG pages load only when **Load more results** is selected, and the function observes the instance's `Retry-After` value when provided; unlimited third-party capacity cannot be guaranteed. For predictable higher-volume use, operate your own SearXNG instance with an appropriate capacity and bot-protection configuration. `.env.example` lists variable names only; it is not loaded by the static site or deployed automatically. Keep GIPHY/KLIPY keys server-side, never in `config.js` or browser code. A function 404 means it is missing from the configured Supabase project or the project URL is wrong.
- **People:** The Friends page has Friends, Recents, Requests, and Blocked tabs. Recents lists every other profile from your latest direct and group conversations. Username search shows each result's friend/request/blocked state. Blocking removes the friendship and pending requests, prevents new requests and conversations in either direction, and hides shared conversation history from both users. Unblocking does not restore a friendship.
- **Watch-party rooms:** Member photos open their profiles; right-click (desktop) or long-press (mobile) opens friend, mute, block, report, and admin-only kick actions. Admin avatars have a gradient ring. Public rooms allow all members to use voice when enabled; non-public rooms require admin approval per member. Kicked members can return only after the admin invites them again. A user's public active room appears on their profile as a tap-to-join card with the current video and a horizontally scrollable row of member avatars. Room block/report actions use `chat-schema.sql` and the latest `rooms-schema.sql`; reports are stored privately in `room_reports`.

## 6. Test checklist (use two accounts)
1. Sign up, confirm email, log in → Nova home opens. Use the gear to open Profile.
2. Settings: change Quick Reaction, tick/untick every switch, reload — values persist.
3. Add a friend by username on account A; accept on account B; both show friend bubbles.
4. Call `Nova.logWatch(...)` for a few videos; check Videos, Keywords, Channels, Interests.
5. Hide a section on A, open A's profile from B — it is gone.
6. Contact us creates a row in `support_tickets`. Delete Account (type DELETE) removes the user.
7. After running `chat-schema.sql`, search users by username; test friend requests, the Friends/Recents/Requests/Blocked tabs, block/unblock and verify blocked users cannot request or open shared chats.
8. Accept a friend request on two accounts, exchange messages, and verify updates arrive without refreshing. Test group creation, @username suggestions, document/photo/video/audio uploads, contact sharing, camera capture, and microphone permissions. Verify incoming bubbles remain left-aligned and outgoing bubbles right-aligned with the chat surface transparent.
9. Deploy the `chat-media-search` Edge Function and configure SearXNG/GIPHY/KLIPY as needed. Search and send SearXNG images/GIFs, GIPHY GIFs/stickers, and KLIPY GIFs/stickers; verify results stay in the page and arrive for the other member through Realtime.
10. After running `rooms-schema.sql`, create a private room with two accounts. Confirm the guest mic is blocked until the admin enables it in People, then revoke access and verify the mic turns off. Test avatar click, right-click/long-press actions, friend/mute/block/report, and admin-only kick; confirm the kicked account cannot rejoin until the admin invites it again.
11. Create a public room and verify member avatars replace the Nova wordmark while mics are active, the admin has a gradient ring, and another member's profile shows a tap-to-join card with a horizontally scrollable row of all room members.

## 7. Notes
- The anon key in `config.js` is meant to be public. Never put the `service_role` key in any file here.
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
- These features require the site to be served by Vercel (or another host configured to run the `/api` functions); opening `nova-home.html` as a local file or hosting only static files will not work. For local testing, add `YOUTUBE_API_KEY=...` to the ignored `.env.local` file and run `node dev-server.js`.
- `api/youtube.js` — YouTube Data API proxy (search with endless scrolling, link lookup). **Needs the env var `YOUTUBE_API_KEY`.**
- `api/extract.js` — finds the playable video on a web page (mp4/webm/m3u8, `<video>`, og:video, JSON-LD, YouTube/Vimeo/Dailymotion embeds) and imports only the video. DRM sites (Netflix, Prime, Disney+) cannot be imported.
- `api/websearch.js` — plain web search for the Web tab.
- `nova-add.js` — client helpers: confirm popup (Add / Cancel), multi-video chooser, link parsing.

**Setup:** Vercel → Project → Settings → Environment Variables → add `YOUTUBE_API_KEY` (Production, Preview, Development; mark Sensitive) → redeploy. In Google Cloud restrict the key to **YouTube Data API v3**. Do not put the key in `config.js` or any browser file.
**Local test:** copy `.env.local.example` to `.env.local`, add the key, run `node dev-server.js`.

### In-app browser (Web tab)
Search the web (or type an address) and pages open **inside Nova** through `api/browse.js`. Website JavaScript runs in an isolated sandboxed iframe. Tap any video on the page (a `<video>`, an embedded YouTube/Vimeo/Dailymotion player, a YouTube link, a link to an `.mp4`/`.m3u8`) and Nova asks **Add / Cancel**; only that video goes to the room, never the website.
- Safety: page fetches use the same SSRF guard as `api/extract.js` (no localhost / private networks / cloud metadata). The iframe has an opaque origin with no access to Nova's login or storage, and cannot open pop-ups, download files, or navigate the top-level page. Site scripts can still make HTTPS/WSS requests; browser CORS and site restrictions still apply.
- Limits: this sandbox is not a full browser. Site sign-in, cookies, downloads, pop-ups, or some media features may not work. Pages still loading after 12 seconds show retry and open-original options instead of an indefinite spinner. YouTube's full homepage requires its own browser cookies, so open it with "Open original website"; use Nova search or a direct video link to add videos. The Node server adds OS-installed CA certificates to Node's trusted roots where supported, while keeping certificate verification enabled. Untrusted self-signed certificates remain blocked; install the issuing CA in the server's system trust store or set `NODE_EXTRA_CA_CERTS` to its PEM file before starting Node. Nova can sync only direct secure video links and officially embeddable players; it cannot extract protected or account-bound streams.
