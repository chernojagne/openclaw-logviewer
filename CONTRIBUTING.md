# Contributing to OpenClaw Log Viewer

Thanks for your interest in contributing! Here's how you can help.

## Reporting Bugs

1. Check [existing issues](https://github.com/chernojagne/openclaw-logviewer/issues) to avoid duplicates.
2. Open a new issue using the **Bug Report** template.
3. Include the log file (or a sanitized snippet) that triggers the problem, if possible.

## Suggesting Features

Open an issue using the **Feature Request** template and describe the use case.

## Submitting Changes

1. Fork the repo and create a branch from `main`.
2. Install dependencies: `npm ci`
3. Start the dev server: `npm run dev`
4. Make your changes.
5. Test locally by loading an OpenClaw NDJSON log file through the UI.
6. Commit with a clear message describing **what** and **why**.
7. Open a Pull Request against `main`.

## Code Style

- Vanilla JavaScript — no frameworks, no transpilers.
- Use `const`/`let`, never `var`.
- Keep the frontend dependency-free (Chart.js via CDN is the only exception).
- Match the existing indentation (4 spaces).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
