import type { ProjectInfo } from '../api.ts';
import { t } from '../i18n/index.ts';
import { showTab } from '../state.ts';
import { h, ltr, rich } from '../ui/dom.ts';
import { languageChips, typeText } from './project.ts';

/** The FloCMS packages shown first on the Overview, in this order. */
const MAIN_PACKAGES = ['hostkurd/flocms-core', 'hostkurd/flocms-admin', 'hostkurd/flocms-api'];

export function overviewTab(info: ProjectInfo): HTMLElement {
  return h('div', { class: 'cards' }, projectCard(info), databaseCard(info), packagesCard(info));
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
