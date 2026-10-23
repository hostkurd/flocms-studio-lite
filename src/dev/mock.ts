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
    case 'flo_capture':
      await wait(300);
      return capture(String(args.path), args.args as string[]);
    case 'task_start':
      return startTask(args as { id: string; program: string; args: string[] });
    case 'generator_preview':
      await wait(700);
      return previewOf(args.args as string[]);
    case 'task_cancel':
      return null;
    case 'folder_status':
      return { exists: false, empty: false, parentExists: true };
    case 'env_set':
      return null;
    case 'home_folder':
      return 'C:\\Users\\dev';
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

// ---- php flo output, as the real commands print it ------------------------

const DOCTOR = {
  ok: true,
  failed: 0,
  warnings: 2,
  checks: [
    ['ok', 'PHP version', '8.3.12'],
    ['ok', 'Extension pdo', 'loaded'],
    ['ok', 'Extension mbstring', 'loaded'],
    ['ok', 'Extension fileinfo', 'loaded'],
    ['ok', 'Extension gd', 'loaded'],
    ['ok', 'Extension openssl', 'loaded'],
    ['ok', 'Extension curl', 'loaded'],
    ['ok', 'Extension pdo_mysql', 'loaded'],
    ['ok', 'Composer dependencies', 'installed'],
    ['ok', 'storage/', 'writable'],
    ['ok', 'storage/logs/', 'writable'],
    ['warn', 'storage/cache/', 'missing'],
    ['ok', 'views/cache/', 'writable'],
    ['ok', '.env file', 'present'],
    ['ok', '.env keys', 'complete'],
    ['ok', 'APP_KEY', 'set'],
    ['ok', 'APP_URL', 'http://127.0.0.1:8000'],
    ['ok', 'APP_DEBUG', 'true (local)'],
    ['ok', 'Database', 'connected (mysql)'],
    ['warn', 'Migrations', '2 pending: run php flo migrate'],
    ['ok', 'public/.htaccess', 'rewrite rules present'],
    ['ok', 'Document root', 'point the document root at public/ (the root .htaccess forwards there as a fallback)'],
    ['ok', 'Maintenance mode', 'off'],
  ].map(([status, check, detail]) => ({ status, check, detail })),
};

const ADMIN_DOCTOR = `
flocms-admin 0.39.3
===================

  ✓ config/admin.php found
  ✓ Languages: en, ar, el (default en)
  ✓ Panel pages: /admin/dashboard, /admin/settings, /admin/accounts, /admin/profile

App\\Admin\\Resources\\PropertyResource  (/admin/properties)
------------------------------------------------------
  ✗ Your site has a PropertiesController, which always wins: the panel's /admin/properties pages are not shown.
  ✓ Table "properties" (14 columns)
  ! PropertyResource: table() has no defaultSort(): rows may change places between pages; sort by a unique column such as id

Media library  (/admin/media)
-----------------------------
  ✓ Table "media"
  ✓ Table "media_folders" (folders)
  Permissions: content.media.view, …create, …update, …delete
`;

const MIGRATIONS = [
  ['2026_10_10_000000_create_users_table', 'app', '1', 'Ran'],
  ['2026_10_10_000000_create_api_tables', 'hostkurd/flocms-api', '1', 'Ran'],
  ['2026_10_17_000000_create_settings_table', 'app', '1', 'Ran'],
  ['2026_10_20_091200_create_properties_table', 'app', '3', 'Ran (changed since)'],
  ['2026_10_22_140500_add_featured_to_properties', 'app', '', 'Pending'],
  ['2026_10_22_141000_create_admin_mailings_table', 'app', '', 'Pending'],
];

function table(rows: string[][], head: string[]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const border = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  const line = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ') + ' |';
  return [border, line(head), border, ...rows.map(line), border].join('\n');
}

function capture(path: string, argv: string[]): unknown {
  const command = 'php flo ' + argv.join(' ');
  const out = (stdout: string, code = 0, stderr = '') => ({ code, stdout, stderr, command });
  const p = projects.find((x) => x.path === path);
  switch (argv[0]) {
    case 'doctor':
      return out(JSON.stringify(DOCTOR));
    case 'admin:doctor':
      return out(ADMIN_DOCTOR + '\n', 1, ' ERROR  1 problem(s), 1 warning(s).\n');
    case 'migrate:status':
      if (!p?.database.configured) return out('', 1, ' [ERROR] The database is not configured.');
      return out(table(MIGRATIONS, ['Migration', 'Package', 'Batch', 'Status']) + '\n2 pending; run "php flo migrate".\n');
    case 'db:show':
      return out(JSON.stringify({ connection: { driver: 'mysql', database: 'fectumhellas', server: '11.4.3-MariaDB' }, tables: [
        { table: 'properties', rows: 128 }, { table: 'property_images', rows: 2904 }, { table: 'pages', rows: 14 }, { table: 'users', rows: 6 },
        { table: 'settings', rows: 41 }, { table: 'media', rows: 512 }, { table: 'admin_activity', rows: 2310 }, { table: 'migrations', rows: 22 },
      ] }));
    case 'admin:list':
      return out(table([['Users', '/admin/accounts', 'users', 'users.manage', 'built in'], ['Media', '/admin/media', 'media', 'content.media.view', 'built in'], ['Properties', '/admin/properties', 'properties', 'content.properties.view', 'App\\Admin\\Resources\\PropertyResource']], ['Resource', 'URL', 'Table', 'Permissions', 'Class']));
    default:
      return out('');
  }
}

function startTask(task: { id: string; program: string; args: string[] }): string {
  const shown = (task.program === 'flo' ? 'php flo ' : 'composer ') + task.args.join(' ');
  const say = (line: string, stream: 'out' | 'err' = 'out', after = 0) =>
    setTimeout(() => emit('task-output', { id: task.id, stream, line }), after);
  if (task.args[0] === 'migrate') {
    say('  Migrating 2026_10_22_140500_add_featured_to_properties ... done', 'out', 300);
    say('  Migrating 2026_10_22_141000_create_admin_mailings_table ... done', 'out', 700);
    say('[OK] 2 migration(s) ran (batch 4).', 'out', 900);
  } else if (task.args[0] === 'create-project') {
    say('Creating a "hostkurd/flocms" project at "./' + (task.args[2] ?? 'site') + '"', 'err', 100);
    say('Installing hostkurd/flocms (v2.0.0)', 'err', 200);
    say('Package operations: 6 installs, 0 updates, 0 removals', 'err', 400);
    say('[OK] APP_KEY set in .env.', 'out', 800);
    say('! No terminal to ask in: the project stays as it is (website only). To choose, run: php flo setup', 'out', 900);
  } else if (task.args[0] === 'setup') {
    say('Website + admin panel:', 'out', 100);
    say('    composer require hostkurd/flocms-admin:^0.39.3', 'out', 150);
    say('    php flo admin:install', 'out', 200);
    say('[OK] Created config/admin.php', 'out', 600);
    say('[OK] Done. Next: set DB_* in .env, then `php flo migrate` and `php flo user:create`.', 'out', 900);
  } else if (task.args[0] === 'user:create') {
    say('[OK] User #1 created: ' + (task.args.find((a) => a.startsWith('--email='))?.slice(8) ?? '') + ' (Super Admin, active).', 'out', 300);
  } else if (task.args[0] === 'db:check') {
    say('[OK] Connected (sqlite).', 'out', 200);
  } else if (task.args[0] === 'optimize') {
    say('18/18 [============================] 100%', 'err', 200);
    say('[OK] 18 template(s) compiled into views/cache.', 'out', 400);
  } else {
    say('[OK] Done.', 'out', 300);
  }
  setTimeout(() => emit('task-exit', { id: task.id, code: 0 }), 1100);
  return shown;
}

// A real make:admin-resource Property --migration, as the preview returns it
const RESOURCE_FILE = "<?php\ndeclare(strict_types=1);\n\nnamespace App\\Admin\\Resources;\n\nuse FloCMS\\Admin\\Form\\Fields\\TextInput;\nuse FloCMS\\Admin\\Form\\Form;\nuse FloCMS\\Admin\\Resource;\nuse FloCMS\\Admin\\Table\\Columns\\DateColumn;\nuse FloCMS\\Admin\\Table\\Columns\\TextColumn;\nuse FloCMS\\Admin\\Table\\Table;\n\nfinal class PropertyResource extends Resource\n{\n    protected static string $table = 'properties';\n\n    // URL: /admin/properties\n    protected static string $slug = 'properties';\n\n    protected static bool $timestamps = true;\n\n    protected static string $label = 'Property';\n    protected static string $pluralLabel = 'Properties';\n    protected static ?string $icon = 'list';\n\n    // How Create and Edit open: 'page' (full page), 'modal' (dialog) or 'slide-over'\n    protected static string $formMode = 'page';\n\n    public function form(Form $form): Form\n    {\n        return $form->schema([\n            TextInput::make('title')->translatable()->rules('required|max:190')->columnSpan(2),\n            // Related records (see docs/relationships.md in flocms-admin):\n            // \\FloCMS\\Admin\\Form\\Fields\\BelongsTo::make('category_id')->resource(CategoryResource::class),\n            // \\FloCMS\\Admin\\Form\\Fields\\BelongsToMany::make('tags')->resource(TagResource::class)->pivot('properties_tags', 'item_id', 'tag_id'),\n        ]);\n    }\n\n    public function table(Table $table): Table\n    {\n        return $table\n            ->columns([\n                TextColumn::make('id')->sortable()->toggleable(),   // ->toggleable(): listed in the Columns menu\n                TextColumn::make('title')->searchable()->sortable(),\n                DateColumn::make('updated_at')->sortable()->toggleable(),\n            ])\n            ->defaultSort('id', 'desc');\n    }\n}\n";
const MIGRATION_FILE = "<?php\ndeclare(strict_types=1);\n\nuse FloCMS\\CLI\\Database\\Migration;\nuse FloCMS\\Core\\Database;\n\n/**\n * Table for PropertyResource (flocms-admin). Translatable fields are JSON columns:\n * {\"en\":\"...\",\"ar\":\"...\",\"el\":\"...\"}.\n */\nreturn new class extends Migration\n{\n    public function up(Database $db): void\n    {\n        $json = $db->driver() === 'sqlite' ? 'TEXT' : 'JSON';\n\n        $db->query('CREATE TABLE IF NOT EXISTS `properties` (\n            ' . $this->id($db) . ',\n            `title` ' . $json . ' NULL,\n            `created_at` DATETIME NULL,\n            `updated_at` DATETIME NULL\n        )' . $this->tableOptions($db));\n    }\n\n    public function down(Database $db): void\n    {\n        $db->query('DROP TABLE IF EXISTS `properties`');\n    }\n};\n";

function previewOf(argv: string[]): unknown {
  const name = argv[1] ?? 'Property';
  const command = 'php flo ' + argv.join(' ');
  if (argv[0] !== 'make:admin-resource') {
    return { output: { code: 0, stdout: '[OK] Created.\n', stderr: '', command }, files: [] };
  }
  const files: unknown[] = [{ path: `admin/Resources/${name}Resource.php`, change: 'created', content: RESOURCE_FILE.replaceAll('Property', name), before: null }];
  let stdout = `[OK] Created admin/Resources/${name}Resource.php (URL: /admin/properties, table: properties)\n`;
  if (argv.includes('--migration')) {
    files.push({ path: 'database/migrations/2026_10_23_151840_create_properties_table.php', change: 'created', content: MIGRATION_FILE, before: null });
    stdout += '[OK] Created database/migrations/2026_10_23_151840_create_properties_table.php\n';
  }
  return { output: { code: 0, stdout, stderr: '', command }, files };
}
