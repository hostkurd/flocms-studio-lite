import { api, type Tool } from '../api.ts';
import { t } from '../i18n/index.ts';
import { h, ltr, plain } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { refreshProjects, showProject, showSettings, state, toast } from '../state.ts';

export function sidebar(): HTMLElement {
  const view = state.view;
  const current = view.name === 'project' ? view.path : null;

  const projects = state.projects.length
    ? state.projects.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'nav-item' + (p.path === current ? ' is-current' : ''),
            'aria-current': p.path === current ? 'page' : null,
            title: p.path,
            onclick: () => showProject(p.path),
          },
          h('span', { class: 'dot' + (p.missing ? ' is-missing' : '') }),
          h('span', { class: 'name', dir: 'auto' }, p.name),
          p.missing ? h('span', { class: 'badge', style: 'color:var(--fa-danger)' }, t('sidebar.missing')) : null,
        ),
      )
    : [h('div', { class: 'nav-empty' }, t('sidebar.noProjects'))];

  return h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'F'), h('span', { class: 'brand-name', dir: 'ltr' }, t('app.name'))),
    h(
      'nav',
      { class: 'nav', 'aria-label': t('sidebar.projects') },
      h('div', { class: 'nav-label' }, t('sidebar.projects')),
      projects,
      h(
        'button',
        { type: 'button', class: 'btn', style: 'margin-top:8px', disabled: true, title: t('sidebar.newProject') },
        icon('plus'),
        t('sidebar.newProject'),
      ),
      h('button', { type: 'button', class: 'btn btn-dashed', onclick: openExisting }, t('sidebar.openFolder')),
    ),
    h(
      'div',
      { class: 'computer' },
      h('div', { class: 'label' }, t('sidebar.computer')),
      toolRow('PHP', state.tools?.php),
      toolRow('Composer', state.tools?.composer),
      h(
        'button',
        { type: 'button', class: 'nav-item' + (view.name === 'settings' ? ' is-current' : ''), style: 'padding:0 6px', onclick: showSettings },
        icon('gear'),
        t('sidebar.settings'),
      ),
    ),
  );
}

function toolRow(name: string, tool: Tool | undefined): HTMLElement {
  let value: HTMLElement;
  if (!tool || state.toolsChecking) {
    value = h('span', { class: 'muted small' }, t('tool.checking'));
  } else if (tool.version) {
    value = h('span', { class: 'mono ok' }, ltr(tool.version + ' ✓'));
  } else {
    value = h('span', { class: 'small bad' }, t(tool.error === 'failed' ? 'tool.failed' : 'tool.notFound'));
  }
  return h('div', { class: 'row' }, h('span', null, name), value);
}

export async function openExisting(): Promise<void> {
  const path = await api.pickFolder();
  if (!path) return;
  try {
    const project = await api.addProject(path);
    await refreshProjects();
    showProject(project.path);
  } catch (error) {
    toast(plain(errorText(error as never)), true);
  }
}
