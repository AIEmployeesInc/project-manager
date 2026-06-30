# Project Organizer

A Slack-like app for organizing work by project. Each **channel** has:

- 💬 a live **chat** window
- 📎 a **file upload** panel (right side)
- ✅ a **to-do list**

No login required — people pick a display name and access channels by **link**.
Everything updates **live** for everyone in a channel via websockets.

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Create a channel with **+ New Channel**, then
use **🔗 Copy link** to share a direct link to that channel.

Locally there is **nothing to configure** — the app uses an embedded Postgres
(stored in `./pgdata`) when no `DATABASE_URL` is set. For auto-reload during
development: `npm run dev`.

## How it works

| Piece        | Tech                                                  |
|--------------|-------------------------------------------------------|
| Server       | Node + Express                                        |
| Live updates | Socket.IO (websockets)                                |
| Database     | Postgres (`pg`) in production; embedded PGlite locally |
| File storage | Stored as rows in Postgres (`files.content` BYTEA)    |
| Frontend     | Vanilla HTML/CSS/JS (no build step)                   |

Files:

- `server.js` — REST API + Socket.IO event handlers
- `db.js` — database connection + schema (Postgres / PGlite)
- `public/` — the single-page frontend
- `render.yaml` — Render deployment blueprint

## Deploying for free (Render + Neon)

Everything is stored in Postgres, so the app needs **no persistent disk** — it
runs on a free web host as long as it has a database connection string.

1. **Create a free Postgres database** at <https://neon.tech>. Copy its
   **connection string** (looks like `postgresql://user:pass@host/db?sslmode=require`).
2. **Push this repo to GitHub.**
3. **Create a Web Service** at <https://render.com> from that repo
   (Render auto-detects `render.yaml`). Set one environment variable:
   - `DATABASE_URL` = the Neon connection string from step 1.
4. Deploy. Your app will be live at `https://<your-app>.onrender.com`.

The database schema is created automatically on first startup.

> **Free-tier note:** Render's free web service sleeps after ~15 minutes of
> inactivity; the first visit afterward takes ~30–60s to wake. Your data is
> safe regardless — it lives in Neon, not on the web server.

## Limits & notes

- Max upload size is **10 MB** per file (configurable in `server.js`). Files are
  stored in the database; Neon's free tier includes 0.5 GB. For lots of large
  files, switch file storage to object storage (e.g. Cloudflare R2 / S3).
- There is **no authentication** by design — anyone with a channel link can
  read and post. Don't store secrets here; add a shared password or private
  network if you need access control.
