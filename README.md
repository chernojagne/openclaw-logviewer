# OpenClaw Log Viewer

Web-based log viewer for OpenClaw NDJSON logs with a summary/detail interface.

## Features

- File picker to load any log file from your machine
- Reload button to re-read the currently loaded file
- Search across message, subsystem, logger, and raw text
- Multi-select level and subsystem filters
- Dashboard with counts by level, top subsystems, and stacked bar chart (last 24 hours)
- Detail pane with structured payload view, text fragments, and raw JSON source
- Chart powered by Chart.js with tooltips and responsive layout

## Log Format

The source log is newline-delimited JSON. Each line has:

- `time`: ISO timestamp
- `_meta.logLevelName`: level such as `DEBUG`, `INFO`, `WARN`, `ERROR`
- `_meta.name`: logger name, often a JSON string such as `{"subsystem":"gateway/ws"}`
- Numeric keys (`0`, `1`, `2`, ...): message fragments and payloads

## Run

```sh
npm install
npm start
```

Open in browser:

- http://localhost:3780

Use the file picker button to load a log file.

To bind to a different host/port:

```sh
HOST=0.0.0.0 PORT=3780 npm start
```

## API

- `POST /api/logs/reload` — body `{ "path": "...optional..." }` re-reads the current file
- `POST /api/logs/load-content` — body `{ "content": "...", "sourceLabel": "filename" }` loads log text directly
- `GET /api/logs?q=&level=&subsystem=&logger=&limit=300&offset=0&sort=desc`
- `GET /api/config`
- `GET /health`
