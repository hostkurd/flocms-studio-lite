# Changelog

## Unreleased (0.1.0)

### Stage 5: generators
- A Generate tab (board 3), after Overview: forms for `make:admin-resource`, `make:admin-page`, `make:admin-block`, `make:admin-widget`, `make:controller` and `make:migration`, with the options the commands have (`php flo help <command>`); the command line updates as you type. The four admin generators need flocms-admin.
- Preview (D5) runs the real command in a temporary copy of the project and lists what it would create, change or delete; a changed file (`config/admin.php` when a page or widget registers itself) shows as a diff. Nothing in the project changes.
- The copy's `vendor/` is a folder of its own: Composer's autoloader (`vendor/autoload.php`, `vendor/composer/`) is copied, so the project's classes load from the copy; each package folder is linked (a symbolic link on macOS, a junction on Windows, made without `cmd.exe`). The links are removed first, then the copy; copies left by a Studio closed during a preview are removed at the next start. The copy is readable only by the user (it holds `.env`).
- Create runs the same command in the project, then the Overview, Database and Doctor read the project again.
- The Overview's Quick commands open Generate on a generator: New admin resource, New admin page, New block, New migration (board 1).
- A migration's file name gets the time of Create, so it differs from the preview's; the form says so.

### Stage 4: new project wizard
- New project (board 2): name, folder, languages (any code, one default), what you are building (the five `php flo setup` choices), "Also add the JSON API" for the two website choices; database (SQLite with no setup, or an existing MySQL/MariaDB database); the first admin account when the setup has the admin panel; then Create.
- Create runs, and shows: `composer create-project hostkurd/flocms <name>`, writing `.env`, `php flo setup --as=<choice>`, the API when asked (`composer require hostkurd/flocms-api:^1.3`, `php flo api:install`), `php flo db:check`, `php flo migrate`, `php flo user:create --role=super-admin --password-stdin` (the password goes in on stdin, never on the command line).
- Writing `.env` is Studio's own step (FloCMS has no command for it; agreed): it sets `APP_NAME`, `SITE_NAME`, `APP_URL`, `LANGUAGES`, `DEFAULT_LANG` and the `DB_*` keys, written the way core reads them, and keeps every other line.
- A failed step can be run again after fixing the cause; the project is listed as soon as it exists.
- `php flo setup` gets the Composer chosen in Settings through `COMPOSER_BINARY` (a phar, a .bat or a PHP file).
- Command output without colour codes and control characters (Composer's progress bars).
- A test checks that every command the screens run is on the Rust side's allowed list.

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
