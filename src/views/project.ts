import { api, type ProjectInfo, type ProjectSummary } from '../api.ts';
import { LANGUAGE_NAMES, t, type Key } from '../i18n/index.ts';
import { openTargets, projectType, typeKey } from '../project-type.ts';
import { TABS, isInfo, openPart, refreshProjects, showHome, showTab, startServer, state, stopServer, toast, type Tab } from '../state.ts';
import { h, ltr, plain, rich } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { loadChecks } from '../checks.ts';
import { databaseTab } from './database.ts';
import { doctorTab } from './doctor.ts';
import { generateTab } from './generate.ts';
import { logsTab } from './logs.ts';
import { overviewTab } from './overview.ts';
import { packagesTab } from './packages.ts';

const TAB_LABELS: Record<Tab, Key> = {
  overview: 'tab.overview',
  generate: 'tab.generate',
  database: 'tab.database',
  logs: 'tab.logs',
  packages: 'tab.packages',
  doctor: 'tab.doctor',
};

export function projectView(path: string, tab: Tab): HTMLElement {
  const summary = state.projects.find((p) => p.path === path);
  const info = state.info[path];
  const name = summary?.name ?? path;

  if (summary?.missing || (info && !isInfo(info))) {
    return h(
      'div',
      { class: 'main' },
      head(name, path, null),
      h(
        'div',
        { class: 'notice is-bad' },
        icon('warn', 18),
        h(
          'div',
          { class: 'body' },
          h('span', null, rich(info && !isInfo(info) ? errorText(info) : t('project.missing'))),
          h('div', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => forget(path, name) }, t('project.forget'))),
        ),
      ),
    );
  }

  // The checks run the project's own commands: once when it opens
  if (isInfo(info)) loadChecks(info);
  const content = !isInfo(info)
    ? h('p', { class: 'muted' }, t('common.loading'))
    : tab === 'generate'
      ? generateTab(info)
      : tab === 'packages'
      ? packagesTab(info)
      : tab === 'logs'
        ? logsTab(info)
        : tab === 'database'
          ? databaseTab(info)
          : tab === 'doctor'
            ? doctorTab(info)
            : overviewTab(info);

  return h(
    'div',
    { class: 'main' },
    head(name, path, isInfo(info) ? info : summary ?? null),
    h(
      'nav',
      { class: 'tabs', 'aria-label': t('project.sections') },
      TABS.map((id) =>
        h('button', { type: 'button', class: 'tab', 'aria-current': id === tab ? 'page' : null, onclick: () => showTab(id) }, t(TAB_LABELS[id])),
      ),
    ),
    isInfo(info) ? warnings(info) : null,
    content,
  );
}

function head(name: string, path: string, project: ProjectSummary | ProjectInfo | null): HTMLElement {
  const actions: HTMLElement[] = [];
  if (project && !project.missing) {
    const targets = openTargets(project);
    const lang = 'defaultLanguage' in project ? project.defaultLanguage : null;
    if (targets.site) actions.push(openButton(path, 'globe', 'project.openSite', 'site', lang));
    if (targets.admin) actions.push(openButton(path, 'panel', 'project.openAdmin', 'admin', lang));
    if (targets.api) actions.push(openButton(path, 'braces', 'project.openApi', 'api', lang));
    actions.push(
      h('button', { type: 'button', class: 'btn', onclick: () => run(api.openInEditor(path)) }, icon('code'), t('project.openEditor')),
      h('button', { type: 'button', class: 'btn', onclick: () => run(api.openFolder(path)) }, icon('folder'), t('project.openFolder')),
      serverButton(path),
    );
  }
  return h(
    'div',
    { class: 'page-head' },
    h('div', { class: 'titles' }, h('h1', { dir: 'auto' }, name), h('div', { class: 'mono muted' }, ltr(path))),
    h('div', { class: 'actions' }, actions),
  );
}

function openButton(path: string, iconName: 'globe' | 'panel' | 'braces', label: Key, part: 'site' | 'admin' | 'api', lang: string | null): HTMLElement {
  return h('button', { type: 'button', class: 'btn', onclick: () => run(openPart(path, part, lang)) }, icon(iconName), t(label));
}

/** Start server / Stop server, or what it is doing. */
export function serverButton(path: string, small = false): HTMLElement {
  const busy = state.busy[path];
  const size = small ? ' btn-sm' : '';
  if (busy) {
    return h('button', { type: 'button', class: 'btn' + size, disabled: true }, t(busy === 'starting' ? 'server.starting' : 'server.stopping'));
  }
  if (state.servers[path]) {
    return h('button', { type: 'button', class: 'btn btn-danger' + size, onclick: () => run(stopServer(path)) }, icon('stop', 14), t('server.stop'));
  }
  return h('button', { type: 'button', class: 'btn btn-primary' + size, onclick: () => run(startServer(path).then(() => undefined)) }, icon('play', 14), t('server.start'));
}

function warnings(info: ProjectInfo): HTMLElement | null {
  const items: string[] = [];
  if (!info.hasVendor) items.push(t('project.noVendor'));
  if (!info.hasEnv) items.push(t('project.noEnv'));
  if (!items.length) return null;
  return h('div', { class: 'notice is-warn' }, icon('warn', 18), h('div', { class: 'body' }, items.map((text) => h('span', null, rich(text)))));
}

export async function run(action: Promise<void>): Promise<void> {
  try {
    await action;
  } catch (error) {
    toast(plain(errorText(error as never)), true);
  }
}

async function forget(path: string, name: string): Promise<void> {
  try {
    await api.forgetProject(path);
    delete state.info[path];
    await refreshProjects();
    toast(t('project.forgotten', { name }));
    showHome();
  } catch (error) {
    toast(errorText(error as never), true);
  }
}

/** Each language as a chip, in its own name; the default one first and marked. */
export function languageChips(info: ProjectInfo): HTMLElement {
  const ordered = [...info.languages].sort((x, y) => Number(y === info.defaultLanguage) - Number(x === info.defaultLanguage));
  return h(
    'span',
    { class: 'chips' },
    ordered.map((code) =>
      code === info.defaultLanguage
        ? h('span', { class: 'chip is-default', title: t('overview.defaultLanguage', { lang: languageName(code) }) }, h('bdi', null, languageName(code)), h('span', { class: 'sr-only' }, t('overview.defaultLanguage', { lang: '' })))
        : h('span', { class: 'chip' }, h('bdi', null, languageName(code))),
    ),
  );
}

function languageName(code: string): string {
  if (code in LANGUAGE_NAMES) return LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES];
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name && name !== code) return name;
  } catch {
    // not a language tag the system knows
  }
  return code;
}

export function typeText(info: ProjectSummary): string {
  return t(typeKey(projectType(info)));
}
