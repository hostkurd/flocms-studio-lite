# FloCMS Studio

A desktop app for Windows and macOS that creates, runs and changes
[FloCMS](https://github.com/hostkurd/FloCMS) projects. Every action runs a
real `php flo` or `composer` command in the project and shows it, so
nothing Studio does is hidden or different from the command line.

Studio speaks English, Arabic and Kurdish (Sorani), right to left where the
language is.

> Status: v0.1 in progress. Built so far: the window, the project list,
> project Overview and Packages, Settings.

## What you need

- PHP 8.1 or newer and Composer 2, on PATH or chosen in Settings.
- For a project's database: MySQL/MariaDB, or nothing at all with SQLite
  (`DB_TYPE=sqlite`, `DB_NAME=storage/database.sqlite`).

Studio finds a FloCMS project by its `flo` launcher and a `composer.json`
that is the FloCMS skeleton or requires `hostkurd/flocms-core`.

## Develop

Requirements: Node.js 22.6+, Rust (stable), and on Linux the WebKitGTK
libraries Tauri needs (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`librsvg2-dev`).

```
npm install
npm run tauri dev      # the app, with the interface reloading on save
npm run dev            # the interface alone in a browser, with sample projects
```

`npm run dev` in a plain browser uses sample data (`src/dev/mock.ts`)
instead of the Rust side. Add `?lang=ar`, `?lang=ku`, `?theme=dark` or
`?empty=1` to the address to see the other languages, the dark theme or a
first start. The sample data is never part of a build.

Checks, as CI runs them:

```
npm run check                 # TypeScript
npm test                      # interface tests (node --test)
cd src-tauri
cargo test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Build an installer for the system you are on:

```
npm run tauri build
```

## How it is built

- `src-tauri/` (Rust): settings, finding PHP and Composer, reading projects
  from their files (`composer.json`, `composer.lock`, `.env`,
  `config/config.php`), and running commands.
- `src/` (TypeScript, no framework): the interface. `ui/dom.ts` builds
  elements, `views/` draws each page, `state.ts` holds what is shown.
- `src/i18n/`: `en.ts` is the source; `ar.ts` and `ku.ts` must have every
  key (TypeScript and `tests/i18n.test.ts` check). Words in backticks are
  code (`composer install`, `.env`) and are shown left to right in every
  language.
- `src/styles/tokens.css`: the design tokens of flocms-admin, so Studio
  looks like the panel it manages.

Settings live in `settings.json` in the app's config folder
(`%APPDATA%\com.hostkurd.flocms-studio` on Windows,
`~/Library/Application Support/com.hostkurd.flocms-studio` on macOS).

## Fonts

Bundled under `public/fonts/`, all SIL Open Font License 1.1 (licence files
next to them): Instrument Sans and Noto Sans Arabic (as in flocms-admin),
Bricolage Grotesque (headings) and JetBrains Mono (code).

## License

MIT
