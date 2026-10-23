// What the new project wizard runs, as a list of steps. Kept apart from the
// page so it can be tested: every step is a real command, except "Write
// .env" (FloCMS has no command for it; agreed for stage 4).

export type Setup = 'site-admin' | 'site' | 'admin' | 'api-admin' | 'api';
export const SETUPS: readonly Setup[] = ['site-admin', 'site', 'admin', 'api-admin', 'api'];

export interface WizardInput {
  name: string;
  /** The folder the project folder is created in */
  parent: string;
  languages: string[];
  defaultLanguage: string;
  setup: Setup;
  /** "Also add the JSON API", for the two website setups */
  addApi: boolean;
  database:
    | { type: 'sqlite' }
    | { type: 'mysql'; host: string; port: string; name: string; user: string; password: string };
  /** The first account of the admin panel */
  admin: { name: string; email: string; password: string } | null;
  /** http://127.0.0.1:<port> */
  appUrl: string;
}

export type Step =
  | { kind: 'composer' | 'flo'; label: string; cwd: 'parent' | 'project'; args: string[]; stdin?: string; secret?: boolean }
  | { kind: 'env'; label: string; values: [string, string][] };

export const SQLITE_FILE = 'storage/database.sqlite';

export function hasAdmin(setup: Setup): boolean {
  return setup === 'site-admin' || setup === 'admin' || setup === 'api-admin';
}

export function hasApi(input: Pick<WizardInput, 'setup' | 'addApi'>): boolean {
  return input.setup === 'api' || input.setup === 'api-admin' || (input.addApi && (input.setup === 'site' || input.setup === 'site-admin'));
}

/** A folder name: lower case letters, digits and dashes (it also names the database). */
export function validName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

export function validLanguage(code: string): boolean {
  return /^[a-z]{2,3}$/.test(code);
}

export function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.replace(/[\\/]+$/, '') + sep + name;
}

/** Shown on the button; e.g. "Fectum Hellas" from "fectum-hellas". */
export function appName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function plan(input: WizardInput): Step[] {
  const steps: Step[] = [];
  steps.push({ kind: 'composer', label: 'create', cwd: 'parent', args: ['create-project', 'hostkurd/flocms', input.name] });

  const db = input.database;
  const env: [string, string][] = [
    ['APP_NAME', appName(input.name)],
    ['SITE_NAME', appName(input.name)],
    ['APP_URL', input.appUrl],
    ['LANGUAGES', input.languages.join(',')],
    ['DEFAULT_LANG', input.defaultLanguage],
  ];
  if (db.type === 'sqlite') {
    env.push(['DB_TYPE', 'sqlite'], ['DB_NAME', SQLITE_FILE]);
  } else {
    env.push(['DB_TYPE', 'mysql'], ['DB_HOST', db.host], ['DB_PORT', db.port], ['DB_NAME', db.name], ['DB_USERNAME', db.user], ['DB_PASSWORD', db.password]);
  }
  steps.push({ kind: 'env', label: 'env', values: env });

  steps.push({ kind: 'flo', label: 'setup', cwd: 'project', args: ['setup', `--as=${input.setup}`] });
  if (input.addApi && (input.setup === 'site' || input.setup === 'site-admin')) {
    steps.push({ kind: 'composer', label: 'api', cwd: 'project', args: ['require', 'hostkurd/flocms-api:^1.3'] });
    steps.push({ kind: 'flo', label: 'apiInstall', cwd: 'project', args: ['api:install'] });
  }
  steps.push({ kind: 'flo', label: 'dbCheck', cwd: 'project', args: ['db:check'] });
  steps.push({ kind: 'flo', label: 'migrate', cwd: 'project', args: ['migrate'] });
  if (hasAdmin(input.setup) && input.admin) {
    steps.push({
      kind: 'flo',
      label: 'user',
      cwd: 'project',
      args: ['user:create', `--name=${input.admin.name}`, `--email=${input.admin.email}`, '--role=super-admin', '--password-stdin'],
      stdin: input.admin.password,
      secret: true,
    });
  }
  return steps;
}

/** The command line shown for a step (the password is never in it). */
export function shown(step: Step): string {
  if (step.kind === 'env') return 'Write .env: ' + step.values.map(([k]) => k).join(', ');
  // --name="Site Admin", as a person would type it
  const quote = (a: string) => {
    if (!/[\s"]/.test(a)) return a;
    const option = /^(--[\w-]+=)(.*)$/.exec(a);
    const value = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
    return option ? option[1] + value(option[2] ?? '') : value(a);
  };
  return (step.kind === 'flo' ? 'php flo ' : 'composer ') + step.args.map(quote).join(' ');
}
