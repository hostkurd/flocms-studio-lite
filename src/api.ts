// The Rust side (src-tauri/src/commands.rs), typed. In a plain browser
// (npm run dev without Tauri) a mock answers instead: see src/dev/mock.ts.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export interface Settings {
  language: 'system' | 'en' | 'ar' | 'ku';
  theme: 'system' | 'light' | 'dark';
  phpPath: string;
  composerPath: string;
  editorCommand: string;
  projectFolders: string[];
  projects: string[];
  serverPort: number;
  serverNetwork: boolean;
}

export interface Tool {
  found: boolean;
  path: string | null;
  version: string | null;
  error: 'not_found' | 'failed' | null;
}

export interface DatabaseServer {
  name: string | null;
  version: string | null;
  running: boolean;
}

export interface Tools {
  php: Tool;
  composer: Tool;
  database: DatabaseServer;
}

export interface ServerState {
  path: string;
  running: boolean;
  url: string | null;
  startedAt: number | null;
  exitCode: number | null;
}

export interface LogLine {
  path: string;
  /** server = php flo serve, log = storage/logs/app.log */
  source: 'server' | 'log';
  stream: 'out' | 'err';
  line: string;
  at: number;
}

/** A finished short command */
export interface CommandOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  /** As typed: php flo doctor --format=json */
  command: string;
}

export interface TaskLine {
  id: string;
  stream: 'out' | 'err';
  line: string;
}

export interface TaskExit {
  id: string;
  code: number | null;
}

export type Home = 'site' | 'admin' | 'api';

export interface ProjectSummary {
  path: string;
  name: string;
  home: Home;
  hasAdmin: boolean;
  hasApi: boolean;
  missing: boolean;
}

export interface Package {
  name: string;
  version: string;
}

export interface Database {
  driver: string;
  name: string | null;
  host: string | null;
  port: string | null;
  configured: boolean;
}

export interface ProjectInfo extends ProjectSummary {
  appName: string | null;
  appEnv: string | null;
  appUrl: string | null;
  skeletonVersion: string | null;
  languages: string[];
  defaultLanguage: string | null;
  database: Database;
  packages: Package[];
  otherPackages: Package[];
  hasEnv: boolean;
  hasVendor: boolean;
  hasLock: boolean;
}

/** What a failed command returns: a code to translate and the original text. */
export interface StudioError {
  code: string;
  detail: string;
}

export type Backend = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export type Events = (event: string, handler: (payload: unknown) => void) => Promise<() => void>;

let backend: Backend = (command, args) => invoke(command, args);
let events: Events = (event, handler) => listen(event, (e) => handler(e.payload));
let folderPicker: () => Promise<string | null> = async () => {
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
};

/** Replaces the Rust side (the browser mock, tests). */
export function useBackend(next: Backend, picker?: () => Promise<string | null>, nextEvents?: Events): void {
  backend = next;
  if (picker) folderPicker = picker;
  if (nextEvents) events = nextEvents;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function toError(error: unknown): StudioError {
  if (error && typeof error === 'object' && 'code' in error) {
    const e = error as { code: unknown; detail?: unknown };
    return { code: String(e.code), detail: String(e.detail ?? '') };
  }
  return { code: 'io', detail: error instanceof Error ? error.message : String(error) };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await backend(command, args)) as T;
  } catch (error) {
    throw toError(error);
  }
}

export const api = {
  getSettings: () => call<Settings>('get_settings'),
  saveSettings: (settings: Settings) => call<Settings>('save_settings', { settings }),
  detectTools: () => call<Tools>('detect_tools'),
  listProjects: () => call<ProjectSummary[]>('list_projects'),
  addProject: (path: string) => call<ProjectSummary>('add_project', { path }),
  forgetProject: (path: string) => call<Settings>('forget_project', { path }),
  addProjectFolder: (path: string) => call<Settings>('add_project_folder', { path }),
  projectInfo: (path: string) => call<ProjectInfo>('project_info', { path }),
  openInEditor: (path: string) => call<void>('open_in_editor', { path }),
  openFolder: (path: string) => call<void>('open_folder', { path }),
  openUrl: (url: string) => call<void>('open_url', { url }),
  pickFolder: () => folderPicker(),
  serverStart: (path: string) => call<ServerState>('server_start', { path }),
  serverStop: (path: string) => call<void>('server_stop', { path }),
  serverStates: () => call<ServerState[]>('server_states'),
  serverLogs: (path: string) => call<LogLine[]>('server_logs', { path }),
  serverClearLogs: (path: string) => call<void>('server_clear_logs', { path }),
  floCapture: (path: string, args: string[]) => call<CommandOutput>('flo_capture', { path, args }),
  /** Starts a long command; lines come as task-output, the end as task-exit. Returns the command as shown. */
  taskStart: (task: { id: string; program: 'flo' | 'composer'; cwd: string; args: string[]; stdin?: string; env?: [string, string][] }) =>
    call<string>('task_start', task),
  taskCancel: (id: string) => call<void>('task_cancel', { id }),
  onTaskOutput: (handler: (line: TaskLine) => void) => events('task-output', (p) => handler(p as TaskLine)),
  onTaskExit: (handler: (exit: TaskExit) => void) => events('task-exit', (p) => handler(p as TaskExit)),
  folderStatus: (path: string) => call<{ exists: boolean; empty: boolean; parentExists: boolean }>('folder_status', { path }),
  envSet: (path: string, values: [string, string][]) => call<void>('env_set', { path, values }),
  homeFolder: () => call<string | null>('home_folder'),
  onServerState: (handler: (state: ServerState) => void) => events('server-state', (p) => handler(p as ServerState)),
  onServerLog: (handler: (line: LogLine) => void) => events('server-log', (p) => handler(p as LogLine)),
};
