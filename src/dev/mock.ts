// Browser-only stand-in for the Rust side, for `npm run dev` without Tauri
// and for screenshots. Never part of a build (imported only in DEV).
// URL options: ?lang=ar|ku|en  ?theme=dark|light  ?empty=1  ?view=settings

import { useBackend, type LogLine, type ProjectInfo, type ProjectSummary, type ServerState, type Settings, type Tools } from '../api.ts';

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
  database: { name: 'MariaDB', version: '11.4.3', running: true },
};

// ---- Servers: started on demand, with sample output ----------------------
type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const emit = (event: string, payload: unknown) => (handlers[event] ?? []).forEach((h) => h(payload));
const servers: Record<string, ServerState> = {};
const lines: Record<string, LogLine[]> = {};
let nextPort = 8000;

function log(path: string, line: string, source: LogLine['source'] = 'server', ago = 0): void {
  const entry: LogLine = { path, source, stream: source === 'server' ? 'err' : 'out', line, at: Date.now() - ago };
  (lines[path] ??= []).push(entry);
  emit('server-log', entry);
}

function stamp(ago = 0): string {
  const d = new Date(Date.now() - ago);
  const day = d.toLocaleString('en-US', { weekday: 'short' });
  const month = d.toLocaleString('en-US', { month: 'short' });
  const time = d.toTimeString().slice(0, 8);
  return `[${day} ${month} ${String(d.getDate()).padStart(2, ' ')} ${time} ${d.getFullYear()}]`;
}

function startServer(path: string): ServerState {
  const port = nextPort++;
  const url = `http://127.0.0.1:${port}`;
  const startedAt = Date.now() - (params.has('running') ? 14 * 60000 : 0);
  const state: ServerState = { path, running: true, url: null, startedAt, exitCode: null };
  servers[path] = state;
  setTimeout(() => {
    state.url = url;
    log(path, `[OK] Serving ${path} at ${url} (Ctrl+C to stop)`, 'server', 9000);
    emit('server-state', { ...state });
    const s = stamp();
    log(path, `${s} PHP 8.3.12 Development Server (${url}) started`, 'server', 8800);
    log(path, `${s} 127.0.0.1:51010 Accepted`);
    log(path, `${s} 127.0.0.1:51011 [200]: GET /themes/default/css/style.css`);
    log(path, `${s} 127.0.0.1:51010 Closing`);
    log(path, `${s} FloCMS\\Core\\HttpException: HTTP 404 in ${path}\\vendor\\hostkurd\\flocms-core\\src\\App.php:393`);
    log(path, `${s} Stack trace:`);
    log(path, `${s} #0 ${path}\\public\\index.php(47): FloCMS\\Core\\App::run()`);
    log(path, `${s} #1 {main}`);
    log(path, `${s} PHP Warning:  Undefined array key "cover" in ${path}\\views\\listings\\show.html on line 14`);
    log(path, `[2026-10-23 14:02:19] error: Undefined array key "cover" {"type":"ErrorException","line":14}`, 'log');
    log(path, `${s} 127.0.0.1:51012 [404]: GET /favicon.ico - No such file or directory`);
  }, 250);
  return { ...state };
}

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
    case 'server_start':
      return servers[String(args.path)] ? { ...servers[String(args.path)]! } : startServer(String(args.path));
    case 'server_stop': {
      const path = String(args.path);
      delete servers[path];
      setTimeout(() => emit('server-state', { path, running: false, url: null, startedAt: null, exitCode: 0 }), 200);
      return null;
    }
    case 'server_states':
      return Object.values(servers).map((s) => ({ ...s }));
    case 'server_logs':
      return [...(lines[String(args.path)] ?? [])];
    case 'server_clear_logs':
      lines[String(args.path)] = [];
      return null;
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
  useBackend(
    handle,
    async () => 'C:\\Users\\dev\\Sites',
    async (event, handler) => {
      (handlers[event] ??= []).push(handler);
      return () => (handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler));
    },
  );
  // ?running=1: fectumhellas runs already, as after a reload
  if (params.has('running') && projects[0]) startServer(projects[0].path);
  console.info('[mock] FloCMS Studio is using sample data (no Tauri).');
}
