# Repository Guidelines

## Project Structure & Module Organization

This Node.js/Express application connects WhatsApp through Twilio to KYC search and identity-validation APIs.

- `server.js`: application startup, webhooks, conversation state, API calls, and temporary PDF delivery.
- `authService.js`, `database.js`, `admin-routes.js`: phone authorization, MySQL connection pooling, and admin endpoints.
- `enhanced-menus.js`, `interactive-menu.js`: WhatsApp menu helpers.
- `public/`: admin and login HTML pages, including frontend code.
- `logs/`, `temp/`: generated runtime files; excluded from Git.
- Root Markdown guides document API contracts, access control, and deployment; `nginx-*.conf` contains proxy examples.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from `package-lock.json`.
- `npm start`: run `server.js`; the default port is `3001`.
- `npm run dev`: run with automatic reload; requires `nodemon`, which is currently absent from package dependencies.
- `node --check server.js`: check JavaScript syntax; repeat for each changed JavaScript file.
- `curl http://localhost:3001/health`: check the running application's health endpoint.

There is no build step. `npm test` is a placeholder that exits with failure.

## Coding Style & Naming Conventions

Use CommonJS (`require`, `module.exports`), two-space indentation, semicolons, and `async`/`await`. Match nearby quote style: existing files mix single and double quotes. Use camelCase for functions and variables, and uppercase snake_case for configuration constants. Preserve existing filenames and Spanish user-facing language. Use parameterized SQL through the shared pool and handle asynchronous failures explicitly. No formatter or linter is configured; avoid unrelated formatting changes.

## Testing Guidelines

No automated test framework, test directory, or coverage threshold is configured. Check syntax and manually verify affected flows with development credentials: admin login/logout, phone authorization, WhatsApp menus, KYC responses, OCR, and PDF retrieval. Exercise relevant failure cases. Record commands and outcomes in the pull request. If introducing automated tests, use descriptive `*.test.js` filenames and document their runner.

## Commit & Pull Request Guidelines

Recent commits use `feat: <imperative description>`. Follow that prefix-and-summary format with an appropriate change type. Keep commits focused. Pull requests should describe behavior changes, link applicable issues, list validation results and configuration changes, and include screenshots for admin UI changes.

## Security & Configuration

Keep credentials in an untracked `.env`. Configure `SESSION_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, MySQL `DB_*` settings, Twilio credentials, and KYC API settings before startup. Never commit secrets, session-cookie files, customer identity data, or generated reports. Review database utility scripts before running them against development data.
