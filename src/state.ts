// The app's state and the actions that change it. Views read `state` and
// call actions; every change schedules one render.

import { api, toError, type ProjectInfo, type ProjectSummary, type Settings, type StudioError, type Tools } from './api.ts';

export type Tab = 'overview' | 'packages';
export const TABS: readonly Tab[] = ['overview', 'packages'];

export type View = { name: 'welcome' } | { name: 'settings' } | { name: 'project'; path: string; tab: Tab };

export interface State {
  ready: boolean;
  settings: Settings | null;
  tools: Tools | null;
  toolsChecking: boolean;
  projects: ProjectSummary[];
  view: View;
  /** Project details by path: loaded, or the error reading them */
  info: Record<string, ProjectInfo | StudioError>;
  toasts: { id: number; text: string; bad: boolean }[];
}

export const state: State = {
  ready: false,
  settings: null,
  tools: null,
  toolsChecking: false,
  projects: [],
  view: { name: 'welcome' },
  info: {},
  toasts: [],
};

type Listener = () => void;
const listeners: Listener[] = [];
let scheduled = false;

export function subscribe(listener: Listener): void {
  listeners.push(listener);
}

export function changed(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const listener of listeners) listener();
  });
}

let toastId = 0;
export function toast(text: string, bad = false): void {
  const id = ++toastId;
  state.toasts.push({ id, text, bad });
  changed();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    changed();
  }, bad ? 7000 : 3500);
}

export function isInfo(value: ProjectInfo | StudioError | undefined): value is ProjectInfo {
  return !!value && 'path' in value;
}

// ---- Actions -----------------------------------------------------------

export async function boot(): Promise<void> {
  state.settings = await api.getSettings();
  await refreshProjects();
  const first = state.projects.find((p) => !p.missing);
  state.view = first ? { name: 'project', path: first.path, tab: 'overview' } : { name: 'welcome' };
  state.ready = true;
  changed();
  if (first) void loadInfo(first.path);
  void checkTools();
}

export async function refreshProjects(): Promise<void> {
  state.projects = await api.listProjects();
  changed();
}

export async function checkTools(): Promise<void> {
  state.toolsChecking = true;
  changed();
  try {
    state.tools = await api.detectTools();
  } finally {
    state.toolsChecking = false;
    changed();
  }
}

export async function loadInfo(path: string): Promise<void> {
  try {
    state.info[path] = await api.projectInfo(path);
  } catch (error) {
    state.info[path] = toError(error);
  }
  changed();
}

export function showProject(path: string, tab: Tab = 'overview'): void {
  state.view = { name: 'project', path, tab };
  changed();
  void loadInfo(path);
}

export function showTab(tab: Tab): void {
  if (state.view.name === 'project') {
    state.view = { ...state.view, tab };
    changed();
  }
}

export function showSettings(): void {
  state.view = { name: 'settings' };
  changed();
}

export function showHome(): void {
  const first = state.projects.find((p) => !p.missing);
  if (first) showProject(first.path);
  else {
    state.view = { name: 'welcome' };
    changed();
  }
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const toolsChanged = !state.settings || state.settings.phpPath !== next.phpPath || state.settings.composerPath !== next.composerPath;
  state.settings = await api.saveSettings(next);
  await refreshProjects();
  if (toolsChanged) void checkTools();
  changed();
  return state.settings;
}
