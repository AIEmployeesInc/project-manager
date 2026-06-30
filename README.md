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

For development with auto-reload:

```bash
npm run dev
```

## How it works

| Piece        | Tech                                   |
|--------------|----------------------------------------|
| Server       | Node + Express                         |
| Live updates | Socket.IO (websockets)                 |
| Database     | SQLite (`data.db`, created on startup) |
| File storage | Local disk (`uploads/`), via Multer    |
| Frontend     | Vanilla HTML/CSS/JS (no build step)    |

Files:

- `server.js` — REST API + Socket.IO event handlers
- `db.js` — SQLite schema and connection
- `public/` — the single-page frontend

## Deploying to the cloud

The app listens on `process.env.PORT`, so it works on most hosts as-is.

**Important for a public deployment:** SQLite (`data.db`) and the `uploads/`
folder live on the local filesystem. On hosts with an *ephemeral* filesystem
(many free tiers), that data is wiped on every redeploy/restart. To keep data:

- **Render / Railway / Fly.io:** attach a **persistent disk/volume** and point
  `data.db` and `uploads/` at it.
- **Heavier traffic / scale:** move the database to managed **Postgres** and
  files to **S3-compatible** object storage. (Ask and I can refactor for this.)

## Limits & notes

- Max upload size is **50 MB** per file (configurable in `server.js`).
- There is **no authentication** by design — anyone with a channel link can
  read and post. Don't put secrets here, and consider putting the whole app
  behind a private network or a simple shared password if needed.
