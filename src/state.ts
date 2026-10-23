// The app's state and the actions that change it. Views read `state` and
// call actions; every change schedules one render.

import {
  api,
  toError,
  type LogLine,
  type ProjectInfo,
  type ProjectSummary,
  type ServerState,
  type Settings,
  type StudioError,
  type Tools,
} from './api.ts';
import { t } from './i18n/index.ts';
import { urlFor } from './project-type.ts';

export type Tab = 'overview' | 'logs' | 'packages';
export const TABS: readonly Tab[] = ['overview', 'logs', 'packages'];

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
  /** Running servers by project path */
  servers: Record<string, ServerState>;
  /** Projects whose server is starting or stopping */
  busy: Record<string, 'starting' | 'stopping'>;
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
  servers: {},
  busy: {},
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
  await listenToServers();
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

// ---- Servers and their logs -------------------------------------------------

const KEEP_LINES = 2000;
const logs: Record<string, LogLine[]> = {};
const logListeners = new Set<(line: LogLine) => void>();
const urlWaiters: Record<string, ((url: string | null) => void)[]> = {};

/** Every line so far for a project (the server's and app.log's). */
export function logsFor(path: string): LogLine[] {
  return logs[path] ?? [];
}

/** Called for each new line; returns the function that stops it. */
export function onLog(listener: (line: LogLine) => void): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

export async function clearLogs(path: string): Promise<void> {
  logs[path] = [];
  await api.serverClearLogs(path);
}

async function listenToServers(): Promise<void> {
  await api.onServerState((server) => {
    const wasStopping = state.busy[server.path] === 'stopping';
    // "Starting…" lasts until the address is known
    if (!server.running || server.url) delete state.busy[server.path];
    if (server.running) {
      state.servers[server.path] = server;
      if (server.url) resolveUrl(server.path, server.url);
    } else {
      delete state.servers[server.path];
      resolveUrl(server.path, null);
      if (!wasStopping) {
        const name = state.projects.find((p) => p.path === server.path)?.name ?? server.path;
        toast(t('server.ended', { name, code: server.exitCode ?? '?' }), true);
      }
    }
    changed();
  });
  await api.onServerLog((line) => {
    const list = (logs[line.path] ??= []);
    list.push(line);
    if (list.length > KEEP_LINES) list.splice(0, list.length - KEEP_LINES);
    for (const listener of logListeners) listener(line);
  });
  // Servers that run already (the window was reloaded)
  for (const server of await api.serverStates()) {
    state.servers[server.path] = server;
    logs[server.path] = await api.serverLogs(server.path);
  }
}

function resolveUrl(path: string, url: string | null): void {
  for (const waiter of urlWaiters[path] ?? []) waiter(url);
  delete urlWaiters[path];
}

export async function startServer(path: string): Promise<ServerState | null> {
  if (state.servers[path]) return state.servers[path]!;
  state.busy[path] = 'starting';
  changed();
  try {
    const server = await api.serverStart(path);
    // The event may have come first and already have the address
    const known = state.servers[path] as ServerState | undefined;
    state.servers[path] = { ...server, url: known?.url ?? server.url };
    return state.servers[path]!;
  } catch (error) {
    delete state.busy[path];
    throw toError(error);
  } finally {
    changed();
  }
}

export async function stopServer(path: string): Promise<void> {
  if (!state.servers[path]) return;
  state.busy[path] = 'stopping';
  changed();
  try {
    await api.serverStop(path);
  } catch (error) {
    delete state.busy[path];
    changed();
    throw toError(error);
  }
}

/** The server's address once it is known (null when it ended first). */
export function serverUrl(path: string, timeoutMs = 20000): Promise<string | null> {
  const known = state.servers[path]?.url;
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    (urlWaiters[path] ??= []).push((url) => {
      clearTimeout(timer);
      resolve(url);
    });
  });
}

/** 0.0.0.0 (other devices) is opened as 127.0.0.1 on this computer. */
export function localUrl(url: string): string {
  return url.replace('://0.0.0.0:', '://127.0.0.1:').replace('://[::]:', '://[::1]:');
}

/** Opens the site, the admin or the API, starting the server first if needed. */
export async function openPart(path: string, part: 'site' | 'admin' | 'api', language: string | null): Promise<void> {
  if (!state.servers[path]) await startServer(path);
  const url = await serverUrl(path);
  if (!url) {
    toast(t('server.noUrl'), true);
    return;
  }
  await api.openUrl(urlFor(localUrl(url), part, language));
}
