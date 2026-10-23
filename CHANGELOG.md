# Changelog

## Unreleased (0.1.0)

### Stage 3: Overview, Doctor and Database
- Doctor tab (D4, board 7): `php flo doctor --format=json` with the check names in the reader's language and the details as the command wrote them; `php flo admin:doctor` line by line (✓ ! ✗), problems and warnings first, every line and the full output one click away.
- Database tab (board 5): connection, migrations from `php flo migrate:status` (waiting, ran, changed since, file missing; the package of package migrations), Run migrations, Undo last batch, Fill with seed data, Delete all tables (asks for the database name); tables and row counts from `php flo db:show --format=json`, with Open in admin for resources (`php flo admin:list`).
- On a production site (`APP_ENV=production`) Studio asks before migrate, rollback, seed and fresh, then runs them with `--force` (the CLI refuses without it when nobody can answer).
- Overview: tables and waiting migrations with Run migrations, the checks that need attention, quick commands (clear cache, clear compiled views, optimize, undo optimize) with their output.
- Long commands run in a dialog with their live output and how they ended; only the commands the screens use are allowed.

### Stage 2: server and logs
- Start and stop `php flo serve` per project (D6), on the first free port from the one in Settings; "Other devices on my network" serves on 0.0.0.0.
- Stopping ends `php -S` too: the server runs in its own process group (macOS, Linux) or is stopped with its process tree (Windows).
- Studio records the servers it starts (servers.json) and stops them when it quits; after a crash, the next start stops what was left (only processes that are still PHP).
- The address comes from the "Serving … at" line, reported once the port answers.
- Open site / admin / API start the server when it is not running, then open the running address.
- Logs tab: the server's output and `storage/logs/app.log` (through `php flo log:tail app --follow`), live; Problems filter, connection lines hidden by default, stack traces folded, 404s quiet.
- Overview: Server card, and a notice when `APP_URL` is not the server's address (redirects and e-mails use `APP_URL`).
- Sidebar: running projects, and the MySQL/MariaDB server (D3): version from the client program, running from port 3306.

### Stage 1: window and project list
- The window: sidebar with projects, This computer (PHP and Composer versions), Settings.
- Projects come from project folders (their sub-folders) and from Open existing folder; a project that is gone stays in the list, marked, until it is removed.
- Project Overview from the project's files, without PHP: project type (the five `php flo setup` choices, plus a website with the API), environment, languages, skeleton version, database settings, FloCMS package versions from `composer.lock`.
- Packages tab: every installed package.
- Open site / admin / API (from `APP_URL` for now; the running server from stage 2), open in editor, open folder.
- Settings: language (English, Arabic, Kurdish or the system's), theme, PHP and Composer, server port and network access, editor command, project folders.
- English, Arabic and Kurdish, right to left for Arabic and Kurdish; flocms-admin's design tokens; light and dark.
