// Draws the window from the state: the sidebar every time, the main area
// only when what it shows changes (so forms keep their focus and input).

import { resolveLanguage, setLanguage, t } from './i18n/index.ts';
import { state, subscribe } from './state.ts';
import { h } from './ui/dom.ts';
import { projectView } from './views/project.ts';
import { settingsView, type SettingsView } from './views/settings.ts';
import { sidebar } from './views/sidebar.ts';
import { welcomeView } from './views/welcome.ts';

let root: HTMLElement;
let mainKey = '';
let mainEl: HTMLElement | null = null;
let settingsPage: SettingsView | null = null;
let appearance = '';

export function mount(element: HTMLElement): void {
  root = element;
  subscribe(render);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  render();
}

function applyAppearance(): boolean {
  const settings = state.settings;
  const lang = resolveLanguage(settings?.language ?? 'system', navigator.languages ?? [navigator.language]);
  const theme = settings?.theme === 'light' || settings?.theme === 'dark' ? settings.theme : 'auto';
  const next = `${lang}/${theme}`;
  if (next === appearance) return false;
  appearance = next;
  setLanguage(lang);
  document.documentElement.dataset.theme = theme;
  document.title = t('app.name');
  return true;
}

function keyFor(): string {
  const view = state.view;
  if (view.name !== 'project') return view.name;
  const info = state.info[view.path];
  // A new object after each load, so a reload redraws
  return `project:${view.path}:${view.tab}:${info ? infoVersion(info) : 'loading'}`;
}

const versions = new WeakMap<object, number>();
let versionCounter = 0;
function infoVersion(info: object): number {
  let v = versions.get(info);
  if (v === undefined) {
    v = ++versionCounter;
    versions.set(info, v);
  }
  return v;
}

function render(): void {
  const languageChanged = applyAppearance();
  if (!state.ready) {
    root.replaceChildren(h('div', { class: 'main' }, h('p', { class: 'muted' }, t('common.loading'))));
    return;
  }
  const key = keyFor();
  if (languageChanged || key !== mainKey || !mainEl) {
    mainKey = key;
    settingsPage = null;
    const view = state.view;
    if (view.name === 'settings') {
      settingsPage = settingsView();
      mainEl = settingsPage.el;
    } else if (view.name === 'project') {
      mainEl = projectView(view.path, view.tab);
    } else {
      mainEl = welcomeView();
    }
  } else {
    settingsPage?.update();
  }
  const toasts = h(
    'div',
    { class: 'toasts', role: 'status', 'aria-live': 'polite' },
    state.toasts.map((toast) => h('div', { class: 'toast' + (toast.bad ? ' is-bad' : '') }, toast.text)),
  );
  root.replaceChildren(h('div', { class: 'app' }, sidebar(), mainEl), toasts);
}
