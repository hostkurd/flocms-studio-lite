// The Generate tab (board 3, D5): a form per generator, the command it makes,
// Preview (the real command, in a temporary copy of the project) and Create
// (the same command in the project).

import { api, toError, type FileChange, type GeneratorPreview, type ProjectInfo } from '../api.ts';
import { checksFor, loadChecks } from '../checks.ts';
import { GENERATORS, args, diff, generator, ready, shownCommand, type Field, type Generator, type GeneratorId, type Values } from '../generators.ts';
import { errorMessage } from '../flo-output.ts';
import { formatNumber, hasKey, t, type Key } from '../i18n/index.ts';
import { loadInfo, showTab, toast } from '../state.ts';
import { clear, h, ltr, rich } from '../ui/dom.ts';
import { errorText } from '../ui/errors.ts';
import { icon } from '../ui/icons.ts';
import { runInDialog } from '../ui/runner.ts';

interface Draft {
  id: GeneratorId;
  values: Record<GeneratorId, Values>;
  preview: GeneratorPreview | null;
  /** The command the preview ran, to tell when the answers changed */
  previewOf: string | null;
  previewError: string | null;
  previewing: boolean;
  /** The file shown under the list */
  open: string | null;
  /** Counts previews: a result for an older one is dropped */
  run: number;
  /** Draws the tab on screen now (it is rebuilt when the project's details change) */
  redraw: (() => void) | null;
}

// Per project, kept while Studio runs: the tab is redrawn when the project's
// details change, the answers stay.
const drafts = new Map<string, Draft>();

function draftFor(path: string): Draft {
  let draft = drafts.get(path);
  if (!draft) {
    draft = {
      id: 'resource',
      values: { resource: {}, page: {}, block: {}, widget: {}, controller: {}, migration: {} },
      preview: null,
      previewOf: null,
      previewError: null,
      previewing: false,
      open: null,
      run: 0,
      redraw: null,
    };
    drafts.set(path, draft);
  }
  return draft;
}

/** Opens the tab on one generator (the Overview's shortcuts). */
export function openGenerator(path: string, id: GeneratorId): void {
  const draft = draftFor(path);
  if (draft.id !== id) resetPreview(draft);
  draft.id = id;
  showTab('generate');
}

function resetPreview(draft: Draft): void {
  draft.run++;
  draft.previewing = false;
  draft.preview = null;
  draft.previewOf = null;
  draft.previewError = null;
  draft.open = null;
}

export function generateTab(info: ProjectInfo): HTMLElement {
  const draft = draftFor(info.path);
  if (!info.hasAdmin && generator(draft.id).admin) draft.id = 'controller';
  const root = h('div', { class: 'stack' });

  const draw = () => {
    clear(root);
    const gen = generator(draft.id);
    root.append(
      h(
        'div',
        { class: 'gen-picker', role: 'group', 'aria-label': t('gen.sections') },
        GENERATORS.map((g) =>
          h(
            'button',
            {
              type: 'button',
              class: 'btn' + (g.id === draft.id ? ' is-selected' : ''),
              'aria-pressed': g.id === draft.id ? 'true' : 'false',
              disabled: draft.previewing && g.id !== draft.id,
              onclick: () => {
                if (g.id === draft.id) return;
                draft.id = g.id;
                resetPreview(draft);
                draw();
              },
            },
            t(`gen.tab.${g.id}` as Key),
          ),
        ),
      ),
    );
    if (!info.hasVendor) {
      root.append(h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('error.no_vendor')))));
      return;
    }
    root.append(h('div', { class: 'gen-grid' }, formCard(info, gen, draft, draw), previewCard(draft)));
  };
  draft.redraw = draw;
  draw();
  return root;
}

function formCard(info: ProjectInfo, gen: Generator, draft: Draft, draw: () => void): HTMLElement {
  const values = draft.values[gen.id];
  const command = h('div', { class: 'command-line', dir: 'ltr' });
  const previewButton = h('button', { type: 'button', class: 'btn' }, t('gen.preview'));
  const createButton = h('button', { type: 'button', class: 'btn btn-primary' }, t(`gen.create.${gen.id}` as Key));
  const stale = h('div', { class: 'hint is-warn', hidden: true }, t('gen.stale'));
  const blocked = gen.admin && !info.hasAdmin;

  const update = () => {
    const words = args(gen, values);
    const line = shownCommand(words);
    // A word breaks only between words, never after the dashes of --table
    clear(command);
    line.split(' ').forEach((word, i) => command.append(i ? ' ' : '', h('span', { class: 'word' }, word)));
    command.dataset.command = line;
    const can = ready(values) && !blocked && !draft.previewing;
    previewButton.disabled = !can;
    createButton.disabled = !can;
    stale.hidden = !draft.previewOf || draft.previewOf === line;
  };

  const tables = (checksFor(info.path).db?.tables ?? []).map((x) => x.table);
  const listId = `gen-tables-${gen.id}`;
  const valueFields = gen.fields.filter((f) => f.kind !== 'flag');
  const flags = gen.fields.filter((f) => f.kind === 'flag');

  previewButton.onclick = () => void preview(info, gen, draft, draw);
  createButton.onclick = () => void create(info, gen, draft, draw);

  const card = h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t(`gen.title.${gen.id}` as Key)), ltr(gen.command, 'mono muted')),
    blocked ? h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('gen.needsAdmin')))) : null,
    h('div', { class: 'gen-fields' }, valueFields.map((f) => valueField(gen, f, values, update, tables.length ? listId : null))),
    h('div', { class: 'gen-flags' }, flags.map((f) => flagField(gen, f, values, update))),
    gen.id === 'resource' ? h('div', { class: 'muted small' }, t('gen.resource.note')) : null,
    gen.id === 'migration' ? h('div', { class: 'muted small' }, t('gen.migration.note')) : null,
    tables.length ? h('datalist', { id: listId }, tables.map((name) => h('option', { value: name }))) : null,
    command,
    stale,
    h('div', { class: 'actions end' }, previewButton, createButton),
  );
  update();
  return card;
}

function label(gen: Generator, field: Field): string {
  if (field.name === 'name') return t('gen.name');
  if (field.name === 'force') return t('gen.force');
  return t(`gen.${gen.id}.${field.name}` as Key);
}

function valueField(gen: Generator, field: Field, values: Values, update: () => void, tablesList: string | null): HTMLElement {
  const id = `gen-${gen.id}-${field.name}`;
  const hintKey = `gen.${gen.id}.${field.name}.hint`;
  const hint = hasKey(hintKey) ? h('span', { class: 'muted small', id: id + '-hint' }, rich(t(hintKey as Key))) : null;
  let input: HTMLInputElement | HTMLSelectElement;
  if (field.kind === 'choice') {
    const current = String(values[field.name] ?? field.choices![0]);
    input = h(
      'select',
      { class: 'input', id, onchange: () => { values[field.name] = input.value; update(); } },
      field.choices!.map((c) => h('option', { value: c, selected: c === current }, t(`gen.choice.${field.name}.${c}` as Key))),
    );
  } else {
    // Class names, tables and URLs are code: left to right in every language
    const code = field.code || field.name === 'name';
    const tableField = field.name === 'table' || field.name === 'create';
    input = h('input', {
      class: 'input' + (code ? ' mono' : ''),
      id,
      dir: code ? 'ltr' : 'auto',
      value: String(values[field.name] ?? ''),
      spellcheck: 'false',
      autocomplete: 'off',
      // Existing tables to pick from (not for a table that is still to be created)
      list: tableField && field.name !== 'create' && tablesList ? tablesList : null,
      'aria-describedby': hint ? id + '-hint' : null,
      'aria-required': field.name === 'name' ? 'true' : null,
      oninput: () => { values[field.name] = input.value; update(); },
    });
  }
  return h('div', { class: 'field' }, h('label', { for: id }, label(gen, field)), input, hint);
}

function flagField(gen: Generator, field: Field, values: Values, update: () => void): HTMLElement {
  const box = h('input', { type: 'checkbox', checked: values[field.name] === true, onchange: () => { values[field.name] = box.checked; update(); } });
  return h('label', { class: 'check' }, box, h('span', null, rich(label(gen, field))));
}

async function preview(info: ProjectInfo, gen: Generator, draft: Draft, draw: () => void): Promise<void> {
  const words = args(gen, draft.values[gen.id]);
  const run = ++draft.run;
  draft.previewing = true;
  draft.previewError = null;
  draw();
  let result: GeneratorPreview | null = null;
  let failure: string | null = null;
  try {
    result = await api.generatorPreview(info.path, words);
  } catch (error) {
    failure = errorText(toError(error));
  }
  // Another generator was picked, or Create ran, in the meantime
  if (run !== draft.run) return;
  draft.preview = result;
  draft.previewOf = result ? shownCommand(words) : null;
  draft.previewError = failure;
  draft.open = result?.files.find((f) => f.change !== 'deleted')?.path ?? null;
  draft.previewing = false;
  (draft.redraw ?? draw)();
}

async function create(info: ProjectInfo, gen: Generator, draft: Draft, draw: () => void): Promise<void> {
  const words = args(gen, draft.values[gen.id]);
  const ok = await runInDialog(t(`gen.title.${gen.id}` as Key), [{ program: 'flo', cwd: info.path, args: words }]);
  if (!ok) return;
  toast(t('gen.done'));
  resetPreview(draft);
  draft.values[gen.id] = {};
  // A migration or resource changes what the Database tab and Doctor show
  await loadInfo(info.path);
  loadChecks(info, true);
  (draft.redraw ?? draw)();
}

const MARK: Record<FileChange['change'], { sign: string; cls: string }> = {
  created: { sign: '+', cls: 'is-ok' },
  changed: { sign: '~', cls: 'is-warn' },
  deleted: { sign: '−', cls: 'is-bad' },
};

function previewCard(draft: Draft): HTMLElement {
  const card = h('section', { class: 'card gen-preview', 'aria-live': 'polite' });
  const result = draft.preview;
  card.append(
    h(
      'div',
      { class: 'card-head' },
      h('h2', null, t('gen.previewTitle')),
      result ? h('span', { class: 'muted' }, t('gen.fileCount', { count: formatNumber(result.files.length) })) : null,
    ),
  );
  if (draft.previewing) {
    card.append(h('p', { class: 'muted' }, t('gen.previewing')));
    return card;
  }
  if (draft.previewError) {
    card.append(h('div', { class: 'notice is-bad' }, icon('warn', 18), h('span', null, rich(draft.previewError))));
    return card;
  }
  if (!result) {
    card.append(h('p', { class: 'muted' }, t('gen.previewHint')));
    return card;
  }
  const output = (result.output.stdout + '\n' + result.output.stderr).trim();
  if (result.output.code !== 0) {
    card.append(
      h(
        'div',
        { class: 'notice is-bad' },
        icon('warn', 18),
        h('div', { class: 'body' }, h('strong', null, t('gen.failed', { code: result.output.code ?? '?' })), h('span', { dir: 'ltr', style: 'text-align:start' }, ltr(errorMessage(result.output.stderr) || output))),
      ),
    );
    return card;
  }
  if (!result.files.length) {
    card.append(h('p', { class: 'muted' }, t('gen.noFiles')));
  }
  const list = h(
    'ul',
    { class: 'gen-files', dir: 'ltr' },
    result.files.map((file) => {
      const mark = MARK[file.change];
      const selected = file.path === draft.open;
      return h(
        'li',
        null,
        h(
          'button',
          {
            type: 'button',
            class: 'gen-file' + (selected ? ' is-selected' : ''),
            'aria-pressed': selected ? 'true' : 'false',
            disabled: file.change === 'deleted',
            onclick: () => {
              draft.open = file.path;
              card.replaceWith(previewCard(draft));
            },
          },
          h('span', { class: 'gen-sign ' + mark.cls, 'aria-hidden': 'true' }, mark.sign),
          h('span', { class: 'mono' }, file.path),
          h('span', { class: 'gen-change muted', dir: 'auto' }, t(`gen.change.${file.change}` as Key)),
        ),
      );
    }),
  );
  card.append(list);
  const open = result.files.find((f) => f.path === draft.open);
  if (open) card.append(fileView(open));
  // The generator's own lines: [OK] Created …
  if (output) card.append(h('div', { class: 'terminal gen-output' }, output.split('\n').map((line) => h('div', { class: /^\s*\[OK\]/.test(line) ? 'ok' : /^\s*!/.test(line) ? 'warn' : '' }, line))));
  return card;
}

function fileView(file: FileChange): HTMLElement {
  if (file.content === null) return h('p', { class: 'muted' }, t('gen.binary'));
  if (file.change === 'changed' && file.before !== null) {
    return h(
      'pre',
      { class: 'code-view', dir: 'ltr', tabindex: '0', 'aria-label': file.path },
      diff(file.before, file.content).map((line) =>
        h('span', { class: 'diff-' + line.kind }, (line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  ') + line.text + '\n'),
      ),
    );
  }
  return h('pre', { class: 'code-view', dir: 'ltr', tabindex: '0', 'aria-label': file.path }, file.content);
}
