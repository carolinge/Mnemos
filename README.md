# Mnemos

> The code, the database file and the deploy config still use the early codename
> `parchment`. Renaming them would orphan existing `parchment.db` files, so they
> were left alone. Nothing about the app depends on the name.

A deliberately small web notebook for researchers. It opens on today with the cursor
ready; what you write flows by date and threads by task.

Why not just a Markdown editor: research notes are not only prose. Screenshots need to go
in without ceremony, figures need to be resized by hand, a paper is often just a link you
want to drop in, and the charts an AI hands you should stay alive. Mnemos treats all of
that as first-class content rather than attachments.

## What it does

- **A timeline you write into.** Opens on today, cursor placed. Scroll up to load history;
  date headings stick to the top as you go.
- **One card, one task.** A day holds as many cards as you like, each assigned to a single
  task (pick it in the card's corner, or type `#taskname` in the body). Click a task in the
  sidebar to pull out everything under it across every date — the thing that matters most
  when ten projects are running at once. Tasks can be reordered by dragging and given
  their own colour.
- **A note per day.** One line (or several) about the day itself, sitting under the date.
  Hidden by default; the 💭 button toggles them all.
- **WYSIWYG that behaves.** `## ` becomes a heading, `- ` a list, `**bold**` bold, ` ``` `
  a code block, `$E=mc^2$` rendered maths. Selected text raises a formatting bar, an empty
  line raises an insert bar, and code blocks carry a language picker.
- **Raw Markdown when you want it.** Every card has a `</> Source` toggle: read or edit the
  Markdown behind it, or paste a chunk in from somewhere else and switch back.
- **Typora's keyboard map.** ⌘1–⌘6 headings, ⌘K link, ⌘⇧K code block, ⌘⇧\` inline code,
  ⌘T table, ⌘⇧Q quote, ⌘⇧I image, ⌘+/⌘- promote and demote. Taken from Typora's published
  shortcut table, so nothing has to be relearned.
- **Images that behave like text.** Ctrl+V a screenshot and it uploads itself. Images are
  inline, so several share a line and wrap when they run out of room; hover one to drag it
  somewhere else, resize it or remove it. The server files them under `year/month` and
  de-duplicates by content.
- **References from a link.** Paste a DOI / arXiv / PubMed URL and the title, authors, year
  and journal arrive as a compact citation card. When the lookup fails it stays an ordinary
  link rather than blocking you.
- **AI output, pasted whole.** A formatted answer becomes editable text; a full HTML
  artifact with scripts becomes a sandboxed embed that still animates, and can be resized,
  collapsed, or inspected.
- **Diagrams and maths.** ` ```mermaid ` draws a flowchart (loaded lazily, so it never slows
  the first paint); KaTeX renders inline and display maths.
- **Findable later.** ⌘P opens a command palette: search the text (Chinese and English both
  work), type a date to jump there, type a task to filter. The rail on the right edge
  scrubs through months and snaps to days that have notes.
- **Easy to move into.** Old Typora journals (the `##### Mar 12th` shape) import wholesale —
  dates, task attribution and daily notes all come back as structured cards.
- **Nothing lost when the network is.** Every keystroke is drafted locally first and
  re-sent when the connection returns. The dot in the toolbar says which state you're in.
- **The data is yours.** Three exports: one single Markdown file, one file per month, or a
  print-ready page you can save as PDF. Everything lives in one directory — copy it and
  you have a backup.

## Local development

Node 22+. Two terminals:

```bash
# Terminal 1 — backend on :8787
cd server && npm install && ACCESS_PASSWORD=dev npm run dev

# Terminal 2 — Vite dev server, proxies /api and /images to the backend
cd web && npm install && npm run dev
```

Open the URL Vite prints and log in with `dev`.

Tests:

```bash
cd server && npx vitest run   # 83
cd web && npx vitest run      # 70
```

## Deploying to fly.io

One container; SQLite and the images both live on the mounted volume at `/data`.

```bash
fly launch --no-deploy                      # confirm app name and region, keep the fly.toml here
fly volumes create parchment_data --size 3  # 3 GB to start, grow it later
fly secrets set ACCESS_PASSWORD='your-password'
fly deploy
```

Then open `https://<your-app>.fly.dev` and enter the password.

`auto_stop_machines` is on, so the machine sleeps when nobody is using it and wakes on the
next request (a second or two of cold start).

### Trying it in Docker

```bash
docker build -t parchment .
docker run --rm -p 8787:8787 -e ACCESS_PASSWORD=dev -v $PWD/.data:/data parchment
```

Without Docker you can run the production build directly: `cd web && npm run build`, then
`cd server && NODE_ENV=production ACCESS_PASSWORD=dev WEB_DIST=../web/dist npm start`.

## Data and backups

Everything sits under `/data`: `parchment.db` (SQLite — notes, tasks, citation cache) and
`images/year/month/` (originals, uncompressed).

```bash
fly ssh sftp get /data/parchment.db ./backup/parchment.db
```

Or use ⤓ in the toolbar for a full zip (Markdown + images + embedded HTML) that any editor
can open.

## Importing old notes

```bash
cd server
node src/importCli.js --dry old-journal.md    # preview, writes nothing
node src/importCli.js old-journal.md          # import for real
```

The parser understands `##### Mar 12th` date headings (including `<span id="260312">`
anchors), `<font color=...>TASK</font>` markers as task attribution, and loose prose right
after a date as that day's note. It only ever adds; it never deletes or overwrites.

## Built with

Hono and better-sqlite3 on the server (FTS5 trigram index, so Chinese and English are both
searchable); Vite, React and TipTap/ProseMirror on the client, with KaTeX and Mermaid
loaded on demand. Single user, single password, session in an HttpOnly cookie.

## Licence

MIT
