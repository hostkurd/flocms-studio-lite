import { api, type Settings, type Tool } from '../api.ts';
import { LANGUAGE_NAMES, t, type Language } from '../i18n/index.ts';
import { checkTools, saveSettings, showHome, state, toast } from '../state.ts';
import { clear, h, ltr, plain, rich } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';

export interface SettingsView {
  el: HTMLElement;
  /** Called on every state change while the page is open (tool checks). */
  update(): void;
}

export function settingsView(): SettingsView {
  // The form edits a copy; Save writes it.
  const draft: Settings = structuredClone(state.settings!);
  const phpStatus = h('span', { class: 'hint' });
  const composerStatus = h('span', { class: 'hint' });
  const folderList = h('div', { class: 'rows' });
  const projectList = h('div', { class: 'rows' });
  const portHint = h('span', { class: 'hint' }, t('settings.portHint'));
  const saveButton = h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, t('common.save'));

  function update(): void {
    toolStatus(phpStatus, state.tools?.php);
    toolStatus(composerStatus, state.tools?.composer);
  }

  function toolStatus(target: HTMLElement, tool: Tool | undefined): void {
    clear(target);
    if (!tool || state.toolsChecking) {
      target.className = 'hint';
      target.append(t('tool.checking'));
    } else if (tool.version) {
      target.className = 'hint is-ok';
      target.append(...nodes(t('settings.toolFound', { version: '\u0000v', path: '\u0000p' }), { v: tool.version, p: tool.path ?? '' }));
    } else if (tool.error === 'failed') {
      target.className = 'hint is-bad';
      target.append(...nodes(t('settings.toolFailed', { path: '\u0000p' }), { p: tool.path ?? '' }));
    } else {
      target.className = 'hint is-bad';
      target.append(t('settings.toolNotFound'));
    }
  }

  function renderFolders(): void {
    clear(folderList);
    if (!draft.projectFolders.length) folderList.append(h('div', { class: 'hint' }, t('settings.foldersNone')));
    for (const folder of draft.projectFolders) {
      folderList.append(
        h(
          'div',
          { class: 'row' },
          ltr(folder, 'mono'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
            draft.projectFolders = draft.projectFolders.filter((f) => f !== folder);
            renderFolders();
          } }, t('common.remove')),
        ),
      );
    }
    clear(projectList);
    for (const project of draft.projects) {
      projectList.append(
        h(
          'div',
          { class: 'row' },
          ltr(project, 'mono'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
            draft.projects = draft.projects.filter((p) => p !== project);
            renderFolders();
          } }, t('common.remove')),
        ),
      );
    }
    projectSection.hidden = draft.projects.length === 0;
  }

  async function addFolder(): Promise<void> {
    const path = await api.pickFolder();
    if (path && !draft.projectFolders.includes(path)) {
      draft.projectFolders.push(path);
      renderFolders();
    }
  }

  async function save(): Promise<void> {
    if (!Number.isInteger(draft.serverPort) || draft.serverPort < 1 || draft.serverPort > 65535) {
      portHint.className = 'hint is-bad';
      portHint.textContent = t('settings.portInvalid');
      return;
    }
    saveButton.disabled = true;
    try {
      await saveSettings(draft);
      toast(t('common.saved'));
    } catch (error) {
      toast(plain(errorText(error as never)), true);
    } finally {
      saveButton.disabled = false;
    }
  }

  const languageSelect = h(
    'select',
    { class: 'input', id: 's-lang', onchange: (e) => (draft.language = (e.target as HTMLSelectElement).value as Settings['language']) },
    h('option', { value: 'system', selected: draft.language === 'system' }, t('settings.languageSystem')),
    (Object.keys(LANGUAGE_NAMES) as Language[]).map((code) =>
      h('option', { value: code, selected: draft.language === code, lang: code === 'ku' ? 'ckb' : code }, LANGUAGE_NAMES[code]),
    ),
  );

  const themeButtons = (['light', 'dark', 'system'] as const).map((theme) => {
    const label = theme === 'light' ? t('settings.themeLight') : theme === 'dark' ? t('settings.themeDark') : t('settings.themeSystem');
    return h('button', { type: 'button', 'aria-pressed': draft.theme === theme ? 'true' : 'false', onclick: (e) => {
      draft.theme = theme;
      for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
    } }, label);
  });

  const phpInput = h('input', { class: 'input mono', id: 's-php', dir: 'ltr', value: draft.phpPath, placeholder: 'php', oninput: (e) => (draft.phpPath = (e.target as HTMLInputElement).value) });
  const composerInput = h('input', { class: 'input mono', id: 's-composer', dir: 'ltr', value: draft.composerPath, placeholder: 'composer', oninput: (e) => (draft.composerPath = (e.target as HTMLInputElement).value) });

  const hostChoice = (network: boolean, label: string) =>
    h('label', { class: 'opt' }, h('input', { type: 'radio', name: 's-host', checked: draft.serverNetwork === network, onchange: () => (draft.serverNetwork = network) }), label);

  const projectSection = h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('settings.addedProjects')), projectList);

  const el = h(
    'div',
    { class: 'main' },
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'titles' }, h('h1', null, t('settings.title'))),
      h('button', { type: 'button', class: 'btn', onclick: showHome }, icon('back', 16, 'flip-rtl'), t('settings.back')),
    ),
    h(
      'div',
      { class: 'settings' },
      h(
        'section',
        { class: 'card' },
        h('h2', null, t('settings.general')),
        h(
          'div',
          { class: 'two' },
          h('div', { class: 'field' }, h('label', { for: 's-lang' }, t('settings.language')), languageSelect),
          h('div', { class: 'field' }, h('span', { class: 'field-label', id: 's-theme' }, t('settings.theme')), h('div', { class: 'seg', role: 'group', 'aria-labelledby': 's-theme' }, themeButtons)),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, t('settings.tools')), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void checkTools() }, icon('refresh', 14), t('settings.checkAgain'))),
        h('div', { class: 'field' }, h('label', { for: 's-php' }, t('settings.php')), phpInput, h('span', { class: 'hint' }, rich(t('settings.phpHint'))), phpStatus),
        h('div', { class: 'field' }, h('label', { for: 's-composer' }, t('settings.composer')), composerInput, h('span', { class: 'hint' }, rich(t('settings.composerHint'))), composerStatus),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, t('settings.server')),
        h(
          'div',
          { class: 'two' },
          h('div', { class: 'field' }, h('label', { for: 's-port' }, t('settings.port')), h('input', { class: 'input mono', id: 's-port', dir: 'ltr', inputmode: 'numeric', value: String(draft.serverPort), oninput: (e) => (draft.serverPort = Number((e.target as HTMLInputElement).value.trim())) }), portHint),
          h('div', { class: 'field', role: 'radiogroup', 'aria-labelledby': 's-host-label' }, h('span', { class: 'field-label', id: 's-host-label' }, t('settings.host')), hostChoice(false, t('settings.hostLocal')), hostChoice(true, t('settings.hostNetwork')), h('span', { class: 'hint is-warn' }, rich(t('settings.hostWarn')))),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, t('settings.editor')),
        h('div', { class: 'field' }, h('label', { for: 's-editor' }, t('settings.editorCommand')), h('input', { class: 'input mono', id: 's-editor', dir: 'ltr', value: draft.editorCommand, oninput: (e) => (draft.editorCommand = (e.target as HTMLInputElement).value) }), h('span', { class: 'hint' }, rich(t('settings.editorHint')))),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, t('settings.folders')),
        h('div', { class: 'hint' }, t('settings.foldersHint')),
        folderList,
        h('div', null, h('button', { type: 'button', class: 'btn', onclick: addFolder }, icon('folder'), t('settings.addFolder'))),
        projectSection,
      ),
      h('div', { class: 'settings-foot' }, h('span', { class: 'hint' }, t('settings.version', { version: '0.1.0' })), h('button', { type: 'button', class: 'btn', onclick: showHome }, t('common.cancel')), saveButton),
    ),
  );
  renderFolders();
  update();
  return { el, update };
}

/** Text with \0x markers replaced by LTR spans (paths, versions inside a sentence). */
function nodes(text: string, values: Record<string, string>): Node[] {
  return text.split(/(\u0000\w)/).map((part) => (part.startsWith('\u0000') ? ltr(values[part.slice(1)] ?? '', 'mono') : document.createTextNode(part)));
}
