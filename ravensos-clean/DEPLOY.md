# Deploying Raven SOS

The backend is a persistent Node service that **also serves the web app**, so one
deploy gives you both the UI and the API at a single public URL. Once it's live,
you and anyone you test with just open that URL — no local setup, and your
"Failed to fetch" login error disappears.

## Recommended: Render (free, ~5 minutes)

Render runs a persistent Node process with WebSocket support and deploys straight
from GitHub.

**1. Put this project in a GitHub repo.** From this folder:
```bash
git init
git add .
git commit -m "Raven SOS"
git branch -M main
git remote add origin https://github.com/<your-username>/raven-sos.git
git push -u origin main
```
(Create the empty `raven-sos` repo on github.com first.)

**2. Deploy on Render.**
- Go to https://render.com and sign in with GitHub.
- New + → **Blueprint** → pick your `raven-sos` repo.
- Render reads `render.yaml` and configures everything. Click **Apply**.
- Wait for the build. You'll get a URL like `https://raven-sos.onrender.com`.

**3. Open the URL.** That's the live app. Create a profile, add guardians, hold
the SOS, and copy the guardian watch link to open on another phone.

## Alternatives (same repo, no changes)

- **Railway** (railway.app): New Project → Deploy from GitHub repo → it detects
  Node and runs `npm start`. Set the root directory to `backend`.
- **Fly.io** (`flyctl launch`): uses the included `Dockerfile`.
- **Any Docker host**: `docker build -t raven . && docker run -p 4000:4000 raven`.

## Important: data durability

The free tier keeps data in a JSON file on the instance's scratch disk. That's
fine for testing, but the instance **sleeps when idle and resets on redeploy**,
so accounts/alerts will periodically clear (just re-register — takes seconds).

When you want data to persist permanently — and this is also where real SMS,
push, and accounts belong — the next step is to point the backend at **Supabase
Postgres**. The schema is already written (`raven-supabase-schema.sql`), and the
data layer is isolated to one file (`backend/src/db/store.js`), so it's a
contained swap. Say the word and I'll wire it up.

## Custom domain

Once live on Render, add a custom domain (e.g. `app.ravensos.com`) under the
service's Settings → Custom Domains, and point your DNS as instructed.
