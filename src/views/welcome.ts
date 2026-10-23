import { api } from '../api.ts';
import { t } from '../i18n/index.ts';
import { refreshProjects, showHome, state, toast } from '../state.ts';
import { h, plain } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { openExisting } from './sidebar.ts';

export function welcomeView(): HTMLElement {
  return h(
    'div',
    { class: 'main' },
    h(
      'div',
      { class: 'welcome' },
      h('span', { class: 'brand-mark', style: 'width:56px;height:56px;border-radius:14px;font-size:30px', 'aria-hidden': 'true' }, 'F'),
      h('h1', null, t('welcome.title')),
      h('p', null, t('welcome.text')),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: addFolder }, icon('folder'), t('welcome.addFolder')),
        h('button', { type: 'button', class: 'btn', onclick: openExisting }, t('sidebar.openFolder')),
      ),
    ),
  );
}

async function addFolder(): Promise<void> {
  const path = await api.pickFolder();
  if (!path) return;
  try {
    state.settings = await api.addProjectFolder(path);
    await refreshProjects();
    showHome();
  } catch (error) {
    toast(plain(errorText(error as never)), true);
  }
}
