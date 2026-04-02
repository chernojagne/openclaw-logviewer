# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-02

### Added

- Web-based log viewer for OpenClaw NDJSON log files
- Browser file picker for loading logs (no server-side file access needed)
- Dashboard with level totals, top subsystems, and stacked bar chart (Chart.js)
- Rolling 24-hour time chart anchored to filtered results
- Level filtering via toggle pills (DEBUG, INFO, WARN, ERROR, FATAL)
- Subsystem filtering via checkbox selection
- Full-text search with highlighting
- Entry detail pane with formatted JSON tree view
- Paging (100 entries per page)
- Sort by newest or oldest first
- Reload capability for updated log files
- Subsystem icons and color-coded badges
- Single-executable builds for Windows, macOS, and Linux via pkg
- GitHub Actions release workflow (tag-triggered)

[1.0.0]: https://github.com/chernojagne/openclaw-logviewer/releases/tag/v1.0.0
