// Browser-only stand-in for the Rust side, for `npm run dev` without Tauri
// and for screenshots. Never part of a build (imported only in DEV).
// URL options: ?lang=ar|ku|en  ?theme=dark|light  ?empty=1  ?view=settings

import { useBackend, type ProjectInfo, type ProjectSummary, type Settings, type Tools } from '../api.ts';

const params = new URLSearchParams(location.search);

const settings: Settings = {
  language: (params.get('lang') as Settings['language']) ?? 'system',
  theme: (params.get('theme') as Settings['theme']) ?? 'system',
  phpPath: '',
  composerPath: '',
  editorCommand: 'code "{folder}"',
  projectFolders: params.has('empty') ? [] : ['C:\\Sites'],
  projects: params.has('empty') ? [] : ['D:\\Work\\ar-lighting-backend'],
  serverPort: 8000,
  serverNetwork: false,
};

const tools: Tools = {
  php: { found: true, path: 'C:\\php\\8.3\\php.exe', version: '8.3.12', error: null },
  composer: { found: true, path: 'C:\\ProgramData\\ComposerSetup\\bin\\composer.bat', version: '2.8.4', error: null },
};

const core = { name: 'hostkurd/flocms-core', version: '2.8.0' };
const cli = { name: 'hostkurd/flocms-cli', version: '2.0.1' };
const uploader = { name: 'hostkurd/flocms-uploader', version: '1.2.1' };
const captcha = { name: 'hostkurd/flocms-captcha', version: '1.1.0' };
const admin = { name: 'hostkurd/flocms-admin', version: '0.39.3' };
const reactive = { name: 'hostkurd/flocms-reactive', version: '0.5.1' };
const apiPkg = { name: 'hostkurd/flocms-api', version: '1.3.0' };
const others = [{ name: 'psr/log', version: '3.0.2' }];

function project(
  path: string,
  home: ProjectSummary['home'],
  packages: ProjectInfo['packages'],
  extra: Partial<ProjectInfo> = {},
): ProjectInfo {
  const name = path.split(/[\\/]/).pop()!;
  return {
    path,
    name,
    home,
    hasAdmin: packages.includes(admin),
    hasApi: packages.includes(apiPkg),
    missing: false,
    appName: name,
    appEnv: 'local',
    appUrl: 'http://127.0.0.1:8000',
    skeletonVersion: '2.0.0',
    languages: ['en', 'ar', 'ku'],
    defaultLanguage: 'en',
    database: { driver: 'mysql', name: name.replace(/-/g, '_'), host: '127.0.0.1', port: '3306', configured: true },
    packages: [...packages].sort((a, b) => a.name.localeCompare(b.name)),
    otherPackages: others,
    hasEnv: true,
    hasVendor: true,
    hasLock: true,
    ...extra,
  };
}

const projects: ProjectInfo[] = params.has('empty')
  ? []
  : [
      project('C:\\Sites\\fectumhellas', 'site', [core, cli, uploader, captcha, admin, reactive, apiPkg], { languages: ['en', 'ar', 'el'] }),
      project('C:\\Sites\\flocms-website', 'site', [core, cli, uploader, captcha], {
        database: { driver: 'sqlite', name: 'storage/database.sqlite', host: null, port: null, configured: true },
      }),
      project('C:\\Sites\\admin-playground', 'admin', [core, cli, uploader, captcha, admin, reactive], {
        database: { driver: 'mysql', name: null, host: '127.0.0.1', port: '3306', configured: false },
      }),
      project('D:\\Work\\ar-lighting-backend', 'api', [core, cli, uploader, captcha, apiPkg], { languages: ['en', 'ar'] }),
    ];

function summary(p: ProjectInfo): ProjectSummary {
  const { path, name, home, hasAdmin, hasApi, missing } = p;
  return { path, name, home, hasAdmin, hasApi, missing };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (command) {
    case 'get_settings':
      return structuredClone(settings);
    case 'save_settings':
      Object.assign(settings, args.settings as Settings);
      return structuredClone(settings);
    case 'detect_tools':
      await wait(400);
      return structuredClone(tools);
    case 'list_projects':
      return projects.map(summary).sort((a, b) => a.name.localeCompare(b.name));
    case 'project_info': {
      const found = projects.find((p) => p.path === args.path);
      if (!found) throw { code: 'project_missing', detail: String(args.path) };
      return structuredClone(found);
    }
    case 'add_project':
      throw { code: 'not_flocms', detail: String(args.path) };
    case 'forget_project':
      settings.projects = settings.projects.filter((p) => p !== args.path);
      return structuredClone(settings);
    case 'add_project_folder':
      settings.projectFolders.push(String(args.path));
      return structuredClone(settings);
    case 'open_in_editor':
    case 'open_folder':
    case 'open_url':
      console.info('[mock]', command, args);
      return null;
    default:
      throw { code: 'io', detail: `mock: no ${command}` };
  }
}

export function installMock(): void {
  useBackend(handle, async () => 'C:\\Users\\dev\\Sites');
  console.info('[mock] FloCMS Studio is using sample data (no Tauri).');
}
