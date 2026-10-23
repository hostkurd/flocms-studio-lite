import type { ProjectInfo } from '../api.ts';
import { t } from '../i18n/index.ts';
import { h, ltr, rich } from '../ui/dom.ts';

export function packagesTab(info: ProjectInfo): HTMLElement {
  if (!info.hasLock) {
    return h('section', { class: 'card' }, h('div', { class: 'hint is-warn' }, rich(t('packages.none'))));
  }
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('packages.title')), h('span', { class: 'hint' }, rich(t('packages.fromLock')))),
    h(
      'div',
      { class: 'scroll-x' },
      h(
        'table',
        { class: 'list' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('packages.package')), h('th', { scope: 'col' }, t('packages.installed')))),
        h(
          'tbody',
          null,
          info.packages.map((p) => h('tr', null, h('td', { class: 'mono' }, ltr(p.name)), h('td', { class: 'mono' }, ltr(p.version)))),
        ),
      ),
    ),
    info.otherPackages.length
      ? h(
          'details',
          null,
          h('summary', { style: 'cursor:pointer;min-height:32px' }, t('packages.other', { count: info.otherPackages.length })),
          h(
            'div',
            { class: 'mono muted', style: 'display:flex;flex-direction:column;gap:2px;padding-top:6px' },
            info.otherPackages.map((p) => ltr(`${p.name} ${p.version}`)),
          ),
        )
      : null,
  );
}
