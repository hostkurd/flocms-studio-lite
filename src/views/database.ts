// The Database tab (board 5): connection, migrations with Run / Undo,
// tables with row counts. Everything comes from php flo commands (D4).

import { api, type ProjectInfo } from '../api.ts';
import { checksFor, loadDatabase, pendingCount } from '../checks.ts';
import type { Migration } from '../flo-output.ts';
import { t, type Key } from '../i18n/index.ts';
import { openAt } from '../state.ts';
import { h, ltr, rich } from '../ui/dom.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { isProduction, runFlo } from './actions.ts';
import { run } from './project.ts';

const STATE: Record<Migration['state'], { key: Key; cls: string }> = {
  pending: { key: 'db.status.pending', cls: 'is-warn' },
  ran: { key: 'db.status.ran', cls: 'is-ok' },
  changed: { key: 'db.status.changed', cls: 'is-bad' },
  missing: { key: 'db.status.missing', cls: 'is-bad' },
};

export function databaseTab(info: ProjectInfo): HTMLElement {
  const c = checksFor(info.path);
  const db = info.database;
  const editEnv = () => run(openEnv(info));

  const connection = h(
    'section',
    { class: 'card card-row' },
    h(
      'div',
      { class: 'facts' },
      fact(t('db.connection'), h('span', { class: 'status-line' }, h('span', { class: 'dot' + (c.db ? ' is-running' : '') }), ltr(serverName(db.driver, c.db?.connection.server)))),
      fact(t('db.database'), ltr(db.name ?? '—', 'mono')),
      db.host ? fact(t('overview.host'), ltr(db.port ? `${db.host}:${db.port}` : db.host, 'mono')) : null,
      fact(t('db.from'), ltr('.env', 'mono')),
    ),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: editEnv }, rich(t('db.editEnv'))), h('button', { type: 'button', class: 'btn btn-sm', disabled: c.databaseLoading, onclick: () => void loadDatabase(info) }, icon('refresh', 14), t('db.reload'))),
  );

  if (!info.hasVendor) {
    return h('div', { class: 'stack' }, connection, h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('doctor.noVendor')))));
  }
  if (!db.configured) {
    return h('div', { class: 'stack' }, connection, h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('overview.dbNotConfigured')))));
  }
  if (c.databaseError) {
    return h(
      'div',
      { class: 'stack' },
      connection,
      h('div', { class: 'notice is-bad' }, icon('warn', 18), h('div', { class: 'body' }, h('strong', null, t('db.error')), h('span', { dir: 'ltr', style: 'text-align:start' }, ltr(c.databaseError)))),
    );
  }

  return h(
    'div',
    { class: 'stack' },
    connection,
    h('div', { class: 'split' }, migrationsCard(info), tablesCard(info)),
    isProduction(info) ? h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('db.productionNote')))) : null,
  );
}

function migrationsCard(info: ProjectInfo): HTMLElement {
  const c = checksFor(info.path);
  const pending = pendingCount(c);
  const list = c.migrations ?? [];
  // Waiting first, then the newest that ran
  const sorted = [...list].sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending') || b.name.localeCompare(a.name));
  const table = list.length
    ? h(
        'div',
        { class: 'scroll-x' },
        h(
          'table',
          { class: 'list' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('db.col.status')), h('th', { scope: 'col' }, t('db.col.migration')), h('th', { scope: 'col' }, t('db.col.batch')))),
          h(
            'tbody',
            null,
            sorted.map((m) =>
              h(
                'tr',
                null,
                h('td', { style: 'white-space:nowrap' }, h('span', { class: 'pill ' + STATE[m.state].cls }, t(STATE[m.state].key))),
                h(
                  'td',
                  { class: 'mono migration-name' },
                  ltr(m.name),
                  // Migrations of a package (flocms-api, flocms-admin) say whose they are
                  m.package && m.package !== 'app' ? h('div', { class: 'muted small' }, ltr(m.package)) : null,
                ),
                h('td', { class: 'muted' }, m.batch === null ? '—' : ltr(String(m.batch))),
              ),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted' }, c.databaseLoading ? t('common.loading') : t('db.noMigrations'));

  const ran = list.some((m) => m.state !== 'pending');
  return h(
    'section',
    { class: 'card', style: 'flex:3 1 520px' },
    h(
      'div',
      { class: 'card-head' },
      h('div', null, h('h2', null, t('db.migrations')), h('div', { class: 'hint ' + (pending ? 'is-warn' : 'is-ok') }, pending ? t('db.waiting', { count: pending }) : list.length ? t('db.everythingRan') : '')),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !pending, onclick: () => run(runFlo(info, t('db.run'), ['migrate']).then(() => undefined)) }, t('db.run')),
      ),
    ),
    table,
    h(
      'div',
      { class: 'actions card-foot' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: !ran, onclick: () => run(rollback(info)) }, t('db.rollback')),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(seed(info)) }, t('db.seed')),
      h('button', { type: 'button', class: 'btn btn-sm btn-danger', style: 'margin-inline-start:auto', onclick: () => run(fresh(info)) }, t('db.fresh')),
    ),
  );
}

function tablesCard(info: ProjectInfo): HTMLElement {
  const c = checksFor(info.path);
  const tables = c.db?.tables ?? [];
  const body = h('tbody');
  const fill = (filter: string) => {
    body.replaceChildren(
      ...tables
        .filter((tb) => tb.table.toLowerCase().includes(filter.toLowerCase()))
        .map((tb) => {
          const url = c.adminUrls[tb.table];
          return h(
            'tr',
            null,
            h('td', { class: 'mono' }, ltr(tb.table)),
            h('td', { style: 'text-align:end' }, tb.rows === null ? '—' : ltr(tb.rows.toLocaleString('en'))),
            h('td', { style: 'text-align:end' }, url ? h('button', { type: 'button', class: 'link-btn', onclick: () => run(openAt(info.path, url, info.defaultLanguage)), title: url }, t('db.openAdmin')) : null),
          );
        }),
    );
  };
  fill('');
  return h(
    'section',
    { class: 'card', style: 'flex:2 1 340px' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', null, t('db.tables')),
      h('input', { class: 'input', style: 'width:180px;min-height:34px', type: 'search', placeholder: t('db.filterPlaceholder'), 'aria-label': t('db.filter'), oninput: (e: Event) => fill((e.target as HTMLInputElement).value) }),
    ),
    h(
      'div',
      { class: 'scroll-y' },
      h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('db.tables')), h('th', { scope: 'col', style: 'text-align:end' }, t('db.rows')), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, t('db.openAdmin'))))), body),
    ),
    h('div', { class: 'hint' }, t('db.tablesNote', { count: tables.length })),
  );
}

async function rollback(info: ProjectInfo): Promise<void> {
  const yes = await confirmDialog({ title: t('db.rollback.title'), text: h('p', null, rich(t('db.rollback.text'))), action: t('db.rollback.action'), danger: true });
  if (yes) await runFlo(info, t('db.rollback'), ['migrate:rollback']);
}

async function seed(info: ProjectInfo): Promise<void> {
  const yes = await confirmDialog({ title: t('db.seed.title'), text: h('p', null, rich(t('db.seed.text'))), action: t('db.seed.action') });
  if (yes) await runFlo(info, t('db.seed'), ['db:seed']);
}

/** migrate:fresh asks its own question; Studio asks for the database name instead. */
async function fresh(info: ProjectInfo): Promise<void> {
  const name = info.database.name ?? '';
  const yes = await confirmDialog({
    title: t('db.fresh.title'),
    text: h('p', null, rich(t('db.fresh.text', { name }))),
    action: t('db.fresh.action'),
    danger: true,
    typed: name || undefined,
  });
  if (yes) await runFlo(info, t('db.fresh'), ['migrate:fresh', '--force']);
}

function openEnv(info: ProjectInfo): Promise<void> {
  const sep = info.path.includes('\\') ? '\\' : '/';
  return api.openInEditor(info.path + sep + '.env');
}

function driverName(driver: string): string {
  return driver === 'sqlite' ? 'SQLite' : driver === 'mysql' ? 'MySQL / MariaDB' : driver;
}

/** "11.4.3-MariaDB" -> "MariaDB 11.4.3"; "8.0.39" -> "MySQL 8.0.39"; SQLite "3.45.1" -> "SQLite 3.45.1" */
export function serverName(driver: string, server: string | undefined): string {
  if (!server) return driverName(driver);
  const maria = /^([\d.]+)-MariaDB/i.exec(server);
  if (maria) return `MariaDB ${maria[1]}`;
  if (driver === 'sqlite') return `SQLite ${server}`;
  if (driver === 'mysql') return `MySQL ${server.split('-')[0]}`;
  return `${driver} ${server}`;
}

function fact(label: string, value: Node): HTMLElement {
  return h('div', { class: 'fact' }, h('span', { class: 'label' }, label), value);
}

