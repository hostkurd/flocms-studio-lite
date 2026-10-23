import { api, type ProjectInfo } from '../api.ts';
import { relativeTime, t } from '../i18n/index.ts';
import { localUrl, showTab, state } from '../state.ts';
import { h, ltr, rich } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { languageChips, run, serverButton, typeText } from './project.ts';

/** The FloCMS packages shown first on the Overview, in this order. */
const MAIN_PACKAGES = ['hostkurd/flocms-core', 'hostkurd/flocms-admin', 'hostkurd/flocms-api'];

export function overviewTab(info: ProjectInfo): HTMLElement {
  return h('div', { class: 'cards' }, serverCard(info), databaseCard(info), packagesCard(info), projectCard(info));
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
      h('div', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(api.openInEditor(env)) }, t('server.openEnv'))),
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
