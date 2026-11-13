# Nova age-provider (runs on your laptop, exposed with ngrok)

This is the service behind `AGE_PROVIDER_URL`. Nova's server sends it **one still JPEG** at the end of the face scan; it estimates the age with a
deep-learning model **on your own machine** and replies `adult`, `minor` or `uncertain`, signed with a shared secret.
Images are processed in memory only — never saved, never logged.

```
Browser ──scan──▶ Nova (Vercel) ──POST image──▶ ngrok URL ──▶ your laptop: server.py ──▶ DeepFace age model
                                  ◀── signed adult/minor/uncertain ──────────────────────────┘
```

## 1. One-time setup (Python 3.10 or 3.11 recommended)

```bash
cd age-provider
python -m venv .venv
# Windows:  .venv\Scripts\activate        macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env` and set `AGE_PROVIDER_SECRET` to a long random string. Generate one with:
`python -c "import secrets; print(secrets.token_urlsafe(48))"`

## 2. Start it

```bash
python server.py
```

The **first** start downloads the age model (several hundred MB, needs internet, once) — wait for `READY — model loaded`.
Check it: open http://127.0.0.1:8080/health → `{"ok": true, "estimator": "deepface", "ready": true}`.

## 3. Expose it with ngrok

```bash
ngrok http 8080
```

Copy the `https://….ngrok-free.app` address it prints. Your `AGE_PROVIDER_URL` is that address + `/verify`.
(A free ngrok URL changes every restart; ngrok's dashboard offers a free fixed domain so you don't have to update Vercel each time.)

## 4. Tell Nova (Vercel → Settings → Environment Variables, then Redeploy)

| Name | Value |
|---|---|
| `AGE_PROVIDER` | `http` |
| `AGE_PROVIDER_URL` | `https://YOUR-NAME.ngrok-free.app/verify` |
| `AGE_PROVIDER_SECRET` | the **same** string you put in `age-provider/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Project Settings → API (needed for the check to work at all) |

If Nova itself runs on this laptop (`node dev-server.js`), skip ngrok and use `AGE_PROVIDER_URL=http://127.0.0.1:8080/verify` in `.env.local`.

## How the decision is made (important — read this)

The model estimates age to roughly **±4–5 years**. So `.env` has a safety margin:

- estimate **≥ 25** → `adult` (unlocks mature content)
- estimate **< 18** → `minor`
- in between, no face, or more than one face → `uncertain` (user retries; nothing unlocks)

Real adults aged 18–24 will often get "uncertain". Lower `ADULT_AT` (e.g. 21) to be friendlier, at the cost of letting more under-18s through.
This is an age *estimate*, not a certified age-assurance product (ISO/IEC 30107-3) and not ID verification. If you must meet a legal duty
(e.g. UK Online Safety Act, certain US states), use a certified provider instead; this service keeps the same contract, so only the
`estimate()` function in `estimator.py` changes.

## Troubleshooting

| Page says | Cause |
|---|---|
| "Verification is unavailable right now" | laptop off / `server.py` not running / ngrok not running / wrong `AGE_PROVIDER_URL` / secrets differ / model still loading |
| "We couldn't complete the check securely" | reply wasn't signed correctly — the two `AGE_PROVIDER_SECRET`s differ, or the laptop clock is off by more than 2 min |
| "The age check wasn't conclusive" | no/multiple faces or estimate between 18 and 25 — try better light, no hat/filter |
| Slow first scan | model warming up; after that ≈1–3 s on a normal CPU |

Test the plumbing without downloading the model: `ESTIMATOR=mock MOCK_AGE=40 python server.py`
(never use mock for real users). Contract tests: `node tests/age-provider.test.js` from the project root.
