# Changelog

## Unreleased (0.1.0)

### Stage 1: window and project list
- The window: sidebar with projects, This computer (PHP and Composer versions), Settings.
- Projects come from project folders (their sub-folders) and from Open existing folder; a project that is gone stays in the list, marked, until it is removed.
- Project Overview from the project's files, without PHP: project type (the five `php flo setup` choices, plus a website with the API), environment, languages, skeleton version, database settings, FloCMS package versions from `composer.lock`.
- Packages tab: every installed package.
- Open site / admin / API (from `APP_URL` for now; the running server from stage 2), open in editor, open folder.
- Settings: language (English, Arabic, Kurdish or the system's), theme, PHP and Composer, server port and network access, editor command, project folders.
- English, Arabic and Kurdish, right to left for Arabic and Kurdish; flocms-admin's design tokens; light and dark.
