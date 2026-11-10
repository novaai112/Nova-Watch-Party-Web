# Nova-Watch-Party — Auth, Profile & Settings (final package)

Static website + Supabase. No build step. Deploy the folder to Vercel (or any static host).

## Files
| File | What it does |
|---|---|
| `config.js` | Your Supabase URL/anon key + company info (also feeds the policy pages and Support page) |
| `theme.js` | Light/dark theme (`data-theme`), used by login and profile |
| `login.html` | Sign up, log in, Google, forgot/reset password. "Open profile" goes to `profile.html` |
| `profile.html` | Profile home, Settings, Language, Privacy + policies, Support, Social |
| `nova-core.js` | Shared: Supabase client, settings, haptics, auto-translate, languages. Load on **every** page |
| `nova-profile.js` | Profile sections: friends, videos, keywords, channels, interests, socials, preview, hide toggles |
| `schema.sql` | Whole database (3 parts, safe to re-run) |

## 1. Database
Supabase Dashboard → SQL Editor → New query → paste **all of `schema.sql`** → Run.
It creates: `profiles` (+ settings), `gallery` (+ `gallery` storage bucket), `friendships`, `watch_history`, `support_tickets`, `subscriptions`, the views `public_profiles` and `map_users`, and the functions `public_profile`, `log_watch`, `set_like`, `can_invite`, `delete_my_account`.

## 2. Auth settings (Dashboard → Authentication)
- **URL Configuration → Site URL:** `https://nova-watch-party.vercel.app/`
- **Redirect URLs:** add `https://nova-watch-party.vercel.app/**` and, for testing, `http://localhost:3000/**`
- **Providers → Email:** on. Keep "Confirm email" on for production.
- **Providers → Google (optional):** create an OAuth client in Google Cloud Console (type Web). Authorized redirect URI = the callback URL shown in Supabase's Google provider page. Paste Client ID + Secret in Supabase.

## 3. Deploy
Upload the folder to Vercel (or `npx serve .` locally). Keep all files in the same folder.
Flow: `login.html` → "Open profile" → `profile.html`. If a logged-out user opens `profile.html` they are sent to login and brought back after.

## 4. Connect your video / room / chat pages
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
// before sending a room invite:
const { data: ok } = await Nova.sb.rpc('can_invite', { target: friendUserId });
// map: read the view `map_users` (users with Hide Location ON are excluded)
```

## 5. How the settings behave
- **Hide Mature Content** is ON by default. Turning it off needs the "Enable 🔞 Mature Content" YES/NO confirmation. 18+ videos are only shown to people who turned it off.
- **Include 🔞 NSFW** (profile) works only when Hide Mature Content is off.
- **Profile 👁️ / 🙈** hides a section from other people. The database never sends hidden sections to others. **Preview** shows what others see.
- **Restrict Invitations** is enforced by `can_invite`. **Hide Location** by `map_users`.
- **Language:** English, Hindi, Spanish built in. Add one: copy a block inside `T` in `nova-core.js` and add it to `LANGS`.

## 6. Test checklist (use two accounts)
1. Sign up, confirm email, log in → profile opens.
2. Settings: change Quick Reaction, tick/untick every switch, reload — values persist.
3. Add a friend by username on account A; accept on account B; both show friend bubbles.
4. Call `Nova.logWatch(...)` for a few videos; check Videos, Keywords, Channels, Interests.
5. Hide a section on A, open A's profile from B — it is gone.
6. Contact us creates a row in `support_tickets`. Delete Account (type DELETE) removes the user.

## 7. Notes
- The anon key in `config.js` is meant to be public. Never put the `service_role` key in any file here.
- Auto-translate uses an unofficial Google endpoint. Use a paid translation API for production.
- Deleting an account removes database rows. Uploaded gallery files stay in Storage; remove the `<user id>/` folder in Dashboard → Storage if needed.
- The Privacy, Data and Terms pages are generated from `config.js`. They are a good starting point, not legal advice — have a lawyer review them before launch.
- Not built: Friends "Trending" tab, Longest Session / Largest Hosted Room stats, payments (the plan badge reads `subscriptions`, which your payment webhook should fill).
