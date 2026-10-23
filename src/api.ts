// The Rust side (src-tauri/src/commands.rs), typed. In a plain browser
// (npm run dev without Tauri) a mock answers instead: see src/dev/mock.ts.

import { invoke } from '@tauri-apps/api/core';
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

export interface Tools {
  php: Tool;
  composer: Tool;
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

let backend: Backend = (command, args) => invoke(command, args);
let folderPicker: () => Promise<string | null> = async () => {
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
};

/** Replaces the Rust side (the browser mock, tests). */
export function useBackend(next: Backend, picker?: () => Promise<string | null>): void {
  backend = next;
  if (picker) folderPicker = picker;
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
};
