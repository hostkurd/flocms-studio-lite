import { api, type ProjectInfo, type ProjectSummary } from '../api.ts';
import { LANGUAGE_NAMES, t, type Key } from '../i18n/index.ts';
import { openTargets, projectType, typeKey, urlFor } from '../project-type.ts';
import { TABS, isInfo, refreshProjects, showHome, showTab, state, toast, type Tab } from '../state.ts';
import { h, ltr, plain, rich } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { overviewTab } from './overview.ts';
import { packagesTab } from './packages.ts';

const TAB_LABELS: Record<Tab, Key> = {
  overview: 'tab.overview',
  packages: 'tab.packages',
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

  const content = !isInfo(info)
    ? h('p', { class: 'muted' }, t('common.loading'))
    : tab === 'packages'
      ? packagesTab(info)
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
    const base = 'appUrl' in project ? project.appUrl : null;
    const lang = 'defaultLanguage' in project ? project.defaultLanguage : null;
    if (base) {
      if (targets.site) actions.push(openButton('globe', 'project.openSite', urlFor(base, 'site', lang)));
      if (targets.admin) actions.push(openButton('panel', 'project.openAdmin', urlFor(base, 'admin', lang)));
      if (targets.api) actions.push(openButton('braces', 'project.openApi', urlFor(base, 'api', lang)));
    }
    actions.push(
      h('button', { type: 'button', class: 'btn', onclick: () => run(api.openInEditor(path)) }, icon('code'), t('project.openEditor')),
      h('button', { type: 'button', class: 'btn', onclick: () => run(api.openFolder(path)) }, icon('folder'), t('project.openFolder')),
    );
  }
  return h(
    'div',
    { class: 'page-head' },
    h('div', { class: 'titles' }, h('h1', { dir: 'auto' }, name), h('div', { class: 'mono muted' }, ltr(path))),
    h('div', { class: 'actions' }, actions),
  );
}

function openButton(iconName: 'globe' | 'panel' | 'braces', label: Key, url: string): HTMLElement {
  return h('button', { type: 'button', class: 'btn', title: url, onclick: () => run(api.openUrl(url)) }, icon(iconName), t(label));
}

function warnings(info: ProjectInfo): HTMLElement | null {
  const items: string[] = [];
  if (!info.hasVendor) items.push(t('project.noVendor'));
  if (!info.hasEnv) items.push(t('project.noEnv'));
  if (!items.length) return null;
  return h('div', { class: 'notice is-warn' }, icon('warn', 18), h('div', { class: 'body' }, items.map((text) => h('span', null, rich(text)))));
}

async function run(action: Promise<void>): Promise<void> {
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
