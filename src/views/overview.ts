import { api, type ProjectInfo } from '../api.ts';
import { checksFor, pendingCount, runDoctor } from '../checks.ts';
import { relativeTime, t } from '../i18n/index.ts';
import { localUrl, showTab, state } from '../state.ts';
import { h, ltr, rich } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { Terminal, stream } from '../ui/runner.ts';
import type { GeneratorId } from '../generators.ts';
import { runFlo } from './actions.ts';
import { openGenerator } from './generate.ts';
import { checkName, statusIcon } from './doctor.ts';
import { languageChips, run, serverButton, typeText } from './project.ts';

/** The FloCMS packages shown first on the Overview, in this order. */
const MAIN_PACKAGES = ['hostkurd/flocms-core', 'hostkurd/flocms-admin', 'hostkurd/flocms-api'];

export function overviewTab(info: ProjectInfo): HTMLElement {
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'cards' }, serverCard(info), databaseCard(info), packagesCard(info)),
    h('div', { class: 'cards-wide' }, doctorCard(info), quickCard(info), projectCard(info)),
  );
}

/** The checks that need attention (board 1), from both doctors. */
function doctorCard(info: ProjectInfo): HTMLElement {
  const c = checksFor(info.path);
  const items: HTMLElement[] = [];
  for (const check of c.doctor?.checks ?? []) {
    if (check.status !== 'ok') items.push(h('div', { class: 'check-row' }, h('span', { class: 'check-name' }, statusIcon(check.status), h('span', null, checkName(check.check))), h('bdi', { class: 'check-detail mono', dir: 'ltr' }, check.detail)));
  }
  for (const section of c.admin?.sections ?? []) {
    for (const line of section.lines) {
      if (line.status === 'warn' || line.status === 'fail') items.push(h('div', { class: 'check-row admin-line' }, h('span', { class: 'check-name', dir: 'ltr' }, statusIcon(line.status), h('span', null, line.text))));
    }
  }
  const shown = items.slice(0, 6);
  let summary: HTMLElement | null = null;
  if (c.doctorLoading) summary = h('p', { class: 'muted' }, t('doctor.running'));
  else if (!info.hasVendor) summary = h('div', { class: 'hint is-warn' }, rich(t('doctor.noVendor')));
  else if (c.doctorAt && !items.length) summary = h('div', { class: 'hint is-ok status-line' }, statusIcon('ok', 16), t('doctor.allPassed'));
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', null, t('tab.doctor')),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: c.doctorLoading || !info.hasVendor, onclick: () => void runDoctor(info) }, t('doctor.runAgain')),
    ),
    summary,
    shown.length ? h('div', { class: 'rows' }, shown) : null,
    items.length ? h('div', null, h('button', { type: 'button', class: 'link-btn', onclick: () => showTab('doctor') }, t('overview.allChecks'))) : null,
  );
}

/** Quick commands (board 1); their output shows in the card. */
function quickCard(info: ProjectInfo): HTMLElement {
  const terminal = new Terminal();
  terminal.el.hidden = true;
  terminal.el.style.maxHeight = '220px';
  let busy = false;
  const shortcut = (label: string, id: GeneratorId) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openGenerator(info.path, id) }, label);
  const quick = (label: string, args: string[]) =>
    h('button', { type: 'button', class: 'btn btn-sm', disabled: !info.hasVendor, onclick: async () => {
      if (busy) return;
      busy = true;
      terminal.el.hidden = false;
      const started = Date.now();
      const code = await stream({ program: 'flo', cwd: info.path, args }, terminal);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      terminal.add(code === 0 ? t('quick.done', { seconds }) : t('run.failed', { code: code ?? '?' }), code === 0 ? 'ok' : 'bad');
      busy = false;
    } }, label);
  return h(
    'section',
    { class: 'card' },
    h('h2', null, t('overview.quick')),
    // Board 1: the generators most used, opening the Generate tab
    h(
      'div',
      { class: 'quick-grid' },
      info.hasAdmin && info.hasVendor ? [shortcut(t('quick.newResource'), 'resource'), shortcut(t('quick.newPage'), 'page'), shortcut(t('quick.newBlock'), 'block')] : null,
      info.hasVendor ? shortcut(t('quick.newMigration'), 'migration') : null,
    ),
    h('div', { class: 'quick-grid' }, quick(t('quick.cacheClear'), ['cache:clear']), quick(t('quick.viewClear'), ['view:clear']), quick(t('quick.optimize'), ['optimize']), quick(t('quick.optimizeClear'), ['optimize:clear'])),
    terminal.el,
  );
}

function serverCard(info: ProjectInfo): HTMLElement {
  const server = state.servers[info.path];
  const busy = state.busy[info.path];
  const url = server?.url ? localUrl(server.url) : null;
  const label = server ? t('server.running') : t(busy === 'starting' ? 'server.starting' : 'server.stopped');
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'label' }, t('server.label')),
    h('div', { class: 'big status-line' }, h('span', { class: 'dot dot-lg' + (server ? ' is-running' : busy ? ' is-busy' : '') }), label),
    url
      ? h('a', { href: url, class: 'mono', onclick: (e: Event) => { e.preventDefault(); void run(api.openUrl(url)); } }, ltr(url))
      : null,
    server?.startedAt ? h('div', { class: 'hint' }, t('server.started', { time: relativeTime(server.startedAt) })) : null,
    server?.url?.includes('://0.0.0.0:') ? h('div', { class: 'hint is-warn' }, t('server.network')) : null,
    !server && !busy ? h('div', { class: 'hint' }, t('server.notRunning')) : null,
    appUrlNotice(info, url),
    h('div', null, serverButton(info.path, true)),
  );
}

/** When APP_URL is not the server's address, links the site makes go elsewhere. */
function appUrlNotice(info: ProjectInfo, url: string | null): HTMLElement | null {
  if (!url || !info.appUrl) return null;
  if (origin(info.appUrl) === origin(url)) return null;
  const env = info.path + (info.path.includes('\\') ? '\\' : '/') + '.env';
  return h(
    'div',
    { class: 'notice is-warn', style: 'padding:10px 12px' },
    icon('warn', 16),
    h(
      'div',
      { class: 'body' },
      h('span', { class: 'small' }, rich(t('server.appUrl', { appUrl: info.appUrl }))),
      h('div', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(api.openInEditor(env)) }, rich(t('server.openEnv')))),
    ),
  );
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function projectCard(info: ProjectInfo): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'label' }, t('overview.project')),
    h('div', { class: 'big' }, typeText(info)),
    h(
      'div',
      { class: 'rows' },
      row(t('overview.environment'), info.appEnv ? ltr(info.appEnv, 'mono') : h('span', { class: 'muted' }, t('common.notSet'))),
      row(t('overview.languages'), info.languages.length ? languageChips(info) : h('span', { class: 'muted' }, t('common.notSet'))),
      info.skeletonVersion ? row(t('overview.skeleton'), ltr('FloCMS ' + info.skeletonVersion, 'mono')) : null,
    ),
  );
}

function databaseCard(info: ProjectInfo): HTMLElement {
  const db = info.database;
  const driver = db.driver === 'sqlite' ? 'SQLite' : db.driver === 'mysql' ? 'MySQL / MariaDB' : db.driver;
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'label' }, t('overview.database')),
    h('div', { class: 'big' }, ltr(db.name && db.driver !== 'sqlite' ? `${driver} · ${db.name}` : driver)),
    db.configured
      ? h(
          'div',
          { class: 'rows' },
          db.driver === 'sqlite' && db.name ? row(t('overview.dbSqlite'), ltr(db.name, 'mono')) : null,
          db.host ? row(t('overview.host'), ltr(db.port ? `${db.host}:${db.port}` : db.host, 'mono')) : null,
        )
      : h('div', { class: 'hint is-warn' }, rich(t('overview.dbNotConfigured'))),
    db.configured ? migrationsLine(info) : null,
  );
}

function migrationsLine(info: ProjectInfo): HTMLElement | null {
  const c = checksFor(info.path);
  if (c.databaseLoading && !c.migrations) return h('div', { class: 'hint' }, t('common.loading'));
  if (c.databaseError) return h('div', { class: 'hint is-bad', dir: 'ltr', style: 'text-align:start' }, ltr(c.databaseError));
  if (!c.migrations) return null;
  const pending = pendingCount(c);
  return h(
    'div',
    { class: 'stack', style: 'gap:10px' },
    h(
      'div',
      { class: 'small' },
      c.db ? t('overview.tables', { count: c.db.tables.length }) + ' · ' : '',
      pending ? h('strong', { style: 'color:var(--fa-warning)' }, t('db.waiting', { count: pending })) : h('span', { class: 'muted' }, t('db.everythingRan')),
    ),
    pending ? h('div', null, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => run(runFlo(info, t('db.run'), ['migrate']).then(() => undefined)) }, t('db.run'))) : null,
  );
}

function packagesCard(info: ProjectInfo): HTMLElement {
  const shown = MAIN_PACKAGES.map((name) => info.packages.find((p) => p.name === name)).filter((p) => p !== undefined);
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'label' }, t('overview.packages')),
    shown.length
      ? h('div', { class: 'rows' }, shown.map((p) => row(ltr(p.name.replace('hostkurd/', ''), 'mono'), ltr(p.version, 'mono'))))
      : h('div', { class: 'hint is-warn' }, rich(t('packages.none'))),
    h('div', null, h('button', { type: 'button', class: 'link-btn', onclick: () => showTab('packages') }, t('overview.allPackages'))),
  );
}

function row(label: string | Node, value: Node): HTMLElement {
  return h('div', { class: 'row' }, h('span', null, label), value);
}
