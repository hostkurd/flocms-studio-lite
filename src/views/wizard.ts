// New FloCMS project (board 2): Project, Database, Admin account, Create.
// It runs `composer create-project hostkurd/flocms`, `php flo setup --as=…`
// and the steps of src/wizard-plan.ts, showing each command as it runs.

import { api, toError } from '../api.ts';
import { LANGUAGE_NAMES, formatNumber, t, type Key } from '../i18n/index.ts';
import { changed, refreshProjects, showHome, showProject, state } from '../state.ts';
import { clear, h, ltr, plain, rich } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { Terminal, stream } from '../ui/runner.ts';
import { SETUPS, hasAdmin, joinPath, plan, shown, validLanguage, validName, type Setup, type Step, type WizardInput } from '../wizard-plan.ts';

type StepId = 'project' | 'database' | 'admin' | 'create';

interface Draft {
  step: StepId;
  name: string;
  parent: string;
  languages: string[];
  defaultLanguage: string;
  setup: Setup;
  addApi: boolean;
  dbType: 'sqlite' | 'mysql';
  db: { host: string; port: string; name: string; user: string; password: string };
  admin: { name: string; email: string; password: string };
}

// Kept while Studio is open, so a language change or a detour keeps the input
let draft: Draft | null = null;

function freshDraft(): Draft {
  return {
    step: 'project',
    name: '',
    parent: state.settings?.projectFolders[0] ?? '',
    languages: ['en', 'ar', 'ku'],
    defaultLanguage: 'en',
    setup: 'site-admin',
    addApi: false,
    dbType: 'sqlite',
    db: { host: '127.0.0.1', port: '3306', name: '', user: 'root', password: '' },
    admin: { name: '', email: '', password: '' },
  };
}

export function openWizard(): void {
  if (!draft || draft.step === 'create') draft = freshDraft();
  state.view = { name: 'wizard' };
  if (!draft.parent) {
    void api.homeFolder().then((home) => {
      if (draft && !draft.parent && home) {
        draft.parent = home;
        rerender?.();
      }
    });
  }
  changed();
}

let rerender: (() => void) | null = null;

const SETUP_TEXT: Record<Setup, [Key, Key]> = {
  'site-admin': ['wizard.setup.siteAdmin', 'wizard.setup.siteAdminHint'],
  site: ['wizard.setup.site', 'wizard.setup.siteHint'],
  admin: ['wizard.setup.admin', 'wizard.setup.adminHint'],
  'api-admin': ['wizard.setup.apiAdmin', 'wizard.setup.apiAdminHint'],
  api: ['wizard.setup.api', 'wizard.setup.apiHint'],
};

function steps(d: Draft): StepId[] {
  return hasAdmin(d.setup) ? ['project', 'database', 'admin', 'create'] : ['project', 'database', 'create'];
}

const STEP_LABEL: Record<StepId, Key> = {
  project: 'wizard.step.project',
  database: 'wizard.step.database',
  admin: 'wizard.step.admin',
  create: 'wizard.step.create',
};

function input(d: Draft): WizardInput {
  const port = state.settings?.serverPort ?? 8000;
  return {
    name: d.name,
    parent: d.parent,
    languages: d.languages,
    defaultLanguage: d.defaultLanguage,
    setup: d.setup,
    addApi: d.addApi,
    database: d.dbType === 'sqlite' ? { type: 'sqlite' } : { type: 'mysql', ...d.db },
    admin: hasAdmin(d.setup) ? d.admin : null,
    appUrl: `http://127.0.0.1:${port}`,
  };
}

export function wizardView(): HTMLElement {
  draft ??= freshDraft();
  const d = draft;
  const page = h('div', { class: 'wizard' });
  const draw = () => {
    clear(page);
    page.append(head(), stepper(d), body(d, draw));
  };
  rerender = draw;
  draw();
  return h('div', { class: 'main wizard-main' }, page);
}

function head(): HTMLElement {
  return h(
    'div',
    { class: 'page-head', style: 'align-items:center' },
    h('div', { class: 'status-line' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'F'), h('h1', { style: 'font-size:26px' }, t('wizard.title'))),
    h('button', { type: 'button', class: 'link-btn', style: 'font-size:14px', onclick: () => { if (draft?.step === 'create') draft = null; showHome(); } }, t('common.cancel')),
  );
}

function stepper(d: Draft): HTMLElement {
  const list = steps(d);
  const at = list.indexOf(d.step);
  return h(
    'ol',
    { class: 'wizard-steps', 'aria-label': t('wizard.steps') },
    list.map((id, i) =>
      h(
        'li',
        { class: 'wizard-step' + (i === at ? ' is-current' : i < at ? ' is-done' : ''), 'aria-current': i === at ? 'step' : null },
        h('span', { class: 'wizard-dot' }, i < at ? icon('check', 14) : formatNumber(i + 1)),
        t(STEP_LABEL[id]),
      ),
    ),
  );
}

function body(d: Draft, draw: () => void): HTMLElement {
  const go = (step: StepId) => {
    d.step = step;
    draw();
  };
  const list = steps(d);
  const at = list.indexOf(d.step);
  const back = at > 0 && d.step !== 'create' ? h('button', { type: 'button', class: 'btn', onclick: () => go(list[at - 1]!) }, t('wizard.back')) : null;
  const errors = h('div', { class: 'hint is-bad', role: 'alert' });
  const next = (check: () => Promise<string | null> | string | null) =>
    h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      const problem = await check();
      errors.textContent = problem ?? '';
      if (!problem) go(list[at + 1]!);
    } }, t('wizard.next', { step: t(STEP_LABEL[list[at + 1] ?? 'create']) }));

  let form: HTMLElement;
  if (d.step === 'project') form = projectStep(d, draw);
  else if (d.step === 'database') form = databaseStep(d, draw);
  else if (d.step === 'admin') form = adminStep(d);
  else return createStep(d, draw);

  const check = d.step === 'project' ? () => checkProject(d) : d.step === 'database' ? () => checkDatabase(d) : () => checkAdmin(d);
  return h(
    'form',
    { class: 'card wizard-card', onsubmit: (e: Event) => e.preventDefault() },
    form,
    commandsPreview(d),
    errors,
    h('div', { class: 'actions', style: 'justify-content:flex-end' }, back, next(check)),
  );
}

// ---- Step 1: project -----------------------------------------------------

function projectStep(d: Draft, draw: () => void): HTMLElement {
  const where = h('span', { class: 'hint' });
  const showWhere = () => {
    where.replaceChildren(...(d.name && d.parent ? [document.createTextNode(t('wizard.creates') + ' '), ltr(joinPath(d.parent, d.name), 'mono')] : []));
  };
  showWhere();
  const name = h('input', { class: 'input', id: 'w-name', dir: 'ltr', value: d.name, autocomplete: 'off', spellcheck: 'false', placeholder: 'my-site', oninput: (e: Event) => {
    d.name = (e.target as HTMLInputElement).value.trim();
    showWhere();
    previewRefresh?.();
  } });
  const parent = h('input', { class: 'input mono', id: 'w-folder', dir: 'ltr', value: d.parent, oninput: (e: Event) => { d.parent = (e.target as HTMLInputElement).value.trim(); showWhere(); } });
  const browse = h('button', { type: 'button', class: 'btn', onclick: async () => {
    const picked = await api.pickFolder();
    if (picked) {
      d.parent = picked;
      parent.value = picked;
      showWhere();
    }
  } }, t('common.browse'));

  return h(
    'div',
    { class: 'stack', style: 'gap:22px' },
    h(
      'div',
      { class: 'settings two' },
      h('div', { class: 'field' }, h('label', { for: 'w-name' }, t('wizard.name')), name, h('span', { class: 'hint' }, t('wizard.nameHint'))),
      h('div', { class: 'field' }, h('label', { for: 'w-folder' }, t('wizard.folder')), h('div', { class: 'input-row' }, parent, browse), where),
    ),
    languagesField(d, draw),
    setupField(d, draw),
  );
}

function languagesField(d: Draft, draw: () => void): HTMLElement {
  const add = h('input', { class: 'input', dir: 'ltr', style: 'width:110px;min-height:36px', placeholder: 'el', maxlength: '3', 'aria-label': t('wizard.addLanguage') });
  const addLanguage = () => {
    const code = add.value.trim().toLowerCase();
    if (validLanguage(code) && !d.languages.includes(code)) {
      d.languages.push(code);
      draw();
    }
  };
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addLanguage();
    }
  });
  return h(
    'div',
    { class: 'wizard-fieldset', role: 'group', 'aria-labelledby': 'w-group-1' },
    h('div', { class: 'wizard-legend', id: 'w-group-1' }, t('wizard.languages')),
    h(
      'div',
      { class: 'chips', style: 'justify-content:flex-start;gap:8px' },
      d.languages.map((code) =>
        h(
          'span',
          { class: 'lang-chip' + (code === d.defaultLanguage ? ' is-default' : '') },
          h('button', { type: 'button', class: 'lang-main', 'aria-pressed': String(code === d.defaultLanguage), title: t('wizard.makeDefault'), onclick: () => { d.defaultLanguage = code; draw(); } }, h('bdi', null, languageLabel(code)), code === d.defaultLanguage ? h('span', { class: 'hint', style: 'color:inherit' }, ' · ' + t('wizard.default')) : null),
          d.languages.length > 1
            ? h('button', { type: 'button', class: 'lang-remove', 'aria-label': t('wizard.removeLanguage', { lang: languageLabel(code) }), onclick: () => {
                d.languages = d.languages.filter((l) => l !== code);
                if (d.defaultLanguage === code) d.defaultLanguage = d.languages[0]!;
                draw();
              } }, icon('cross', 12))
            : null,
        ),
      ),
      h('span', { class: 'input-row', style: 'gap:6px' }, add, h('button', { type: 'button', class: 'btn btn-sm btn-dashed', onclick: addLanguage }, icon('plus', 14), t('wizard.addLanguage'))),
    ),
    h('span', { class: 'hint' }, rich(t('wizard.languagesHint'))),
  );
}

function languageLabel(code: string): string {
  if (code in LANGUAGE_NAMES) return LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES];
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function setupField(d: Draft, draw: () => void): HTMLElement {
  const website = d.setup === 'site' || d.setup === 'site-admin';
  return h(
    'div',
    { class: 'wizard-fieldset', role: 'group', 'aria-labelledby': 'w-group-2' },
    h('div', { class: 'wizard-legend', id: 'w-group-2' }, t('wizard.building')),
    h(
      'div',
      { class: 'setup-grid' },
      SETUPS.map((setup) =>
        h(
          'label',
          { class: 'check-card' },
          h('input', { type: 'radio', name: 'w-setup', checked: d.setup === setup, onchange: () => { d.setup = setup; draw(); } }),
          h('span', { class: 'check-card-text' }, h('strong', null, t(SETUP_TEXT[setup][0])), h('span', { class: 'hint' }, t(SETUP_TEXT[setup][1]))),
        ),
      ),
    ),
    website
      ? h(
          'label',
          { class: 'check-card', style: 'align-items:center' },
          h('input', { type: 'checkbox', checked: d.addApi, onchange: (e: Event) => { d.addApi = (e.target as HTMLInputElement).checked; draw(); } }),
          h('span', { class: 'check-card-text' }, h('strong', null, t('wizard.addApi')), h('span', { class: 'hint' }, t('wizard.addApiHint'))),
        )
      : null,
    h('span', { class: 'hint' }, t('wizard.laterHint')),
  );
}

async function checkProject(d: Draft): Promise<string | null> {
  if (!validName(d.name)) return t('wizard.nameInvalid');
  if (!d.parent) return t('wizard.folderMissing');
  const status = await api.folderStatus(joinPath(d.parent, d.name));
  if (!status.parentExists) return t('wizard.folderMissing');
  if (status.exists && !status.empty) return t('wizard.folderTaken');
  if (!d.languages.length) return t('wizard.languagesMissing');
  if (!d.db.name) d.db.name = d.name.replace(/-/g, '_');
  return null;
}

// ---- Step 2: database ----------------------------------------------------

function databaseStep(d: Draft, draw: () => void): HTMLElement {
  const db = state.tools?.database;
  const field = (key: keyof Draft['db'], label: Key, type = 'text') =>
    h('div', { class: 'field' }, h('label', { for: 'w-db-' + key }, t(label)), h('input', { class: 'input mono', id: 'w-db-' + key, dir: 'ltr', type, value: d.db[key], autocomplete: 'off', oninput: (e: Event) => (d.db[key] = (e.target as HTMLInputElement).value) }));
  return h(
    'div',
    { class: 'wizard-fieldset', role: 'group', 'aria-labelledby': 'w-group-3' },
    h('div', { class: 'wizard-legend', id: 'w-group-3' }, t('wizard.dbChoose')),
    h(
      'div',
      { class: 'setup-grid', style: 'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))' },
      h('label', { class: 'check-card' }, h('input', { type: 'radio', name: 'w-db', checked: d.dbType === 'sqlite', onchange: () => { d.dbType = 'sqlite'; draw(); } }), h('span', { class: 'check-card-text' }, h('strong', null, t('wizard.dbSqlite')), h('span', { class: 'hint' }, rich(t('wizard.dbSqliteHint'))))),
      h('label', { class: 'check-card' }, h('input', { type: 'radio', name: 'w-db', checked: d.dbType === 'mysql', onchange: () => { d.dbType = 'mysql'; draw(); } }), h('span', { class: 'check-card-text' }, h('strong', null, t('wizard.dbMysql')), h('span', { class: 'hint' }, db?.running ? t('wizard.dbMysqlRunning', { name: db.name ?? 'MySQL' }) : t('wizard.dbMysqlHint')))),
    ),
    d.dbType === 'mysql'
      ? h(
          'div',
          { class: 'stack' },
          h('div', { class: 'settings two' }, field('host', 'wizard.dbHost'), field('port', 'wizard.dbPort'), field('name', 'wizard.dbName'), field('user', 'wizard.dbUser'), field('password', 'wizard.dbPassword', 'password')),
          h('div', { class: 'notice is-info' }, icon('warn', 18), h('span', null, rich(t('wizard.dbExists')))),
        )
      : null,
  );
}

function checkDatabase(d: Draft): string | null {
  if (d.dbType === 'sqlite') return null;
  if (!d.db.host || !d.db.name || !d.db.user) return t('wizard.dbMissing');
  if (!/^\d+$/.test(d.db.port)) return t('settings.portInvalid');
  return null;
}

// ---- Step 3: admin account ------------------------------------------------

function adminStep(d: Draft): HTMLElement {
  const field = (key: keyof Draft['admin'], label: Key, type: string, hint?: Key) =>
    h('div', { class: 'field' }, h('label', { for: 'w-admin-' + key }, t(label)), h('input', { class: 'input', id: 'w-admin-' + key, type, value: d.admin[key], dir: type === 'text' ? 'auto' : 'ltr', autocomplete: type === 'password' ? 'new-password' : 'off', oninput: (e: Event) => { d.admin[key] = (e.target as HTMLInputElement).value; previewRefresh?.(); } }), hint ? h('span', { class: 'hint' }, t(hint)) : null);
  return h(
    'div',
    { class: 'wizard-fieldset', role: 'group', 'aria-labelledby': 'w-group-4' },
    h('div', { class: 'wizard-legend', id: 'w-group-4' }, t('wizard.adminTitle')),
    h('span', { class: 'hint' }, rich(t('wizard.adminHint'))),
    h('div', { class: 'settings two' }, field('name', 'wizard.adminName', 'text'), field('email', 'wizard.adminEmail', 'email'), field('password', 'wizard.adminPassword', 'password', 'wizard.adminPasswordHint')),
  );
}

function checkAdmin(d: Draft): string | null {
  if (!d.admin.name.trim()) return t('wizard.adminNameMissing');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.admin.email)) return t('wizard.adminEmailInvalid');
  if (d.admin.password.length < 8) return t('wizard.adminPasswordHint');
  return null;
}

// ---- What Studio will run, and step 4 ---------------------------------------

let previewRefresh: (() => void) | null = null;

function commandsPreview(d: Draft): HTMLElement {
  const box = h('div', { class: 'terminal', style: 'white-space:pre' });
  const fill = () => {
    clear(box);
    box.append(h('div', { class: 'dim', dir: 'auto' }, t('wizard.willRun')));
    for (const step of plan({ ...input(d), name: d.name || 'my-site' })) {
      box.append(h('div', { class: step.kind === 'env' ? 'dim' : '', dir: 'ltr' }, shownStep(step)));
    }
  };
  previewRefresh = fill;
  fill();
  return box;
}

/** In the command boxes (always left to right): Studio's own step as a code comment. */
function shownStep(step: Step): string {
  return step.kind === 'env' ? `# .env: ${step.values.map(([k]) => k).join(', ')}` : shown(step);
}

/** A step in the list: commands left to right, Studio's own step in the reader's language. */
function stepLabel(step: Step): HTMLElement {
  return step.kind === 'env'
    ? h('span', { dir: 'auto' }, rich(t('wizard.writeEnv', { keys: step.values.map(([k]) => k).join(', ') })))
    : h('span', { class: 'mono ltr', dir: 'ltr' }, shown(step));
}

type RunState = 'waiting' | 'running' | 'done' | 'failed';

function createStep(d: Draft, draw: () => void): HTMLElement {
  const data = input(d);
  const list = plan(data);
  const project = joinPath(d.parent, d.name);
  const states: RunState[] = list.map(() => 'waiting');
  const terminal = new Terminal();
  terminal.el.hidden = true;
  const rows = h('ol', { class: 'run-steps' });
  const status = h('div', { class: 'run-status', role: 'status' });
  const actions = h('div', { class: 'actions', style: 'justify-content:flex-end' });
  let from = 0;

  const drawRows = () => {
    rows.replaceChildren(
      ...list.map((step, i) =>
        h(
          'li',
          { class: 'run-step is-' + states[i] },
          h('span', { class: 'run-mark' }, states[i] === 'done' ? icon('check', 14) : states[i] === 'failed' ? icon('cross', 14) : states[i] === 'running' ? h('span', { class: 'spinner' }) : formatNumber(i + 1)),
          stepLabel(step),
        ),
      ),
    );
  };

  const start = async () => {
    actions.replaceChildren();
    terminal.el.hidden = false;
    status.className = 'run-status';
    status.textContent = t('run.running');
    for (let i = from; i < list.length; i++) {
      states[i] = 'running';
      drawRows();
      const ok = await runStep(list[i]!, d.parent, project, terminal);
      states[i] = ok ? 'done' : 'failed';
      drawRows();
      if (!ok) {
        from = i;
        status.className = 'run-status is-bad';
        status.textContent = t('wizard.failed');
        actions.replaceChildren(
          h('button', { type: 'button', class: 'btn', onclick: () => { d.step = steps(d)[0]!; draw(); } }, t('wizard.change')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void start() }, icon('refresh', 14), t('wizard.retry')),
        );
        if (i > 0) await keep(project);
        return;
      }
    }
    await keep(project);
    status.className = 'run-status is-ok';
    status.textContent = t('wizard.done', { name: d.name });
    actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { draft = null; showProject(project); } }, t('wizard.openProject')));
  };

  drawRows();
  actions.append(
    h('button', { type: 'button', class: 'btn', onclick: () => { d.step = steps(d).at(-2)!; draw(); } }, t('wizard.back')),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void start() }, t('wizard.create')),
  );
  return h(
    'div',
    { class: 'card wizard-card' },
    h('h2', null, t('wizard.createTitle', { name: d.name })),
    h('p', { class: 'hint', style: 'margin:0' }, ltr(project, 'mono')),
    rows,
    terminal.el,
    status,
    actions,
  );
}

/** Once the folder is a project, Studio lists it (also after a failed step). */
async function keep(project: string): Promise<void> {
  const inFolder = (state.settings?.projectFolders ?? []).some((f) => project.startsWith(f.replace(/[\\/]+$/, '')));
  try {
    if (!inFolder) await api.addProject(project);
  } catch {
    // not a project yet (create-project failed): nothing to list
  }
  await refreshProjects();
}

async function runStep(step: Step, parent: string, project: string, terminal: Terminal): Promise<boolean> {
  if (step.kind === 'env') {
    terminal.command(shownStep(step));
    try {
      await api.envSet(project, step.values);
      terminal.add('[OK] .env', 'ok');
      return true;
    } catch (error) {
      terminal.add(plain(errorText(toError(error))), 'bad');
      return false;
    }
  }
  const code = await stream(
    { program: step.kind, cwd: step.cwd === 'parent' ? parent : project, args: step.args, stdin: step.stdin },
    terminal,
  );
  if (code !== 0 && step.label === 'dbCheck') terminal.add(t('wizard.dbCheckFailed'), 'warn');
  return code === 0;
}

export function resetWizard(): void {
  draft = null;
}

