// The generators of the Generate tab (board 3, D5): which `php flo make:…`
// commands get a form, what the form has, and the command it makes. The
// fields follow the commands' own arguments and options (php flo help
// <command> --format=json); kept apart from the page so it can be tested.

export type FieldKind = 'value' | 'flag' | 'choice';

export interface Field {
  /** The option without dashes; "name" is the command's argument */
  name: string;
  kind: FieldKind;
  choices?: readonly string[];
  /** Code-like values (tables, URLs) are written left to right */
  code?: boolean;
}

export interface Generator {
  id: GeneratorId;
  command: string;
  /** Needs flocms-admin in the project */
  admin: boolean;
  fields: readonly Field[];
}

export type GeneratorId = 'resource' | 'page' | 'block' | 'widget' | 'controller' | 'migration';

const force: Field = { name: 'force', kind: 'flag' };

/** The six of board 3, in its order. */
export const GENERATORS: readonly Generator[] = [
  {
    id: 'resource',
    command: 'make:admin-resource',
    admin: true,
    fields: [
      { name: 'name', kind: 'value' },
      { name: 'table', kind: 'value', code: true },
      { name: 'slug', kind: 'value', code: true },
      { name: 'form', kind: 'choice', choices: ['page', 'modal', 'slide-over'] },
      { name: 'migration', kind: 'flag' },
      { name: 'reorderable', kind: 'flag' },
      force,
    ],
  },
  {
    id: 'page',
    command: 'make:admin-page',
    admin: true,
    fields: [
      { name: 'name', kind: 'value' },
      { name: 'group', kind: 'value' },
      { name: 'view', kind: 'flag' },
      { name: 'form', kind: 'flag' },
      { name: 'table', kind: 'value', code: true },
      { name: 'resource', kind: 'value', code: true },
      force,
    ],
  },
  { id: 'block', command: 'make:admin-block', admin: true, fields: [{ name: 'name', kind: 'value' }, force] },
  {
    id: 'widget',
    command: 'make:admin-widget',
    admin: true,
    fields: [
      { name: 'name', kind: 'value' },
      { name: 'type', kind: 'choice', choices: ['stats', 'records', 'chart'] },
      { name: 'resource', kind: 'value', code: true },
      force,
    ],
  },
  {
    id: 'controller',
    command: 'make:controller',
    admin: false,
    fields: [
      { name: 'name', kind: 'value' },
      { name: 'model', kind: 'flag' },
      { name: 'resource', kind: 'flag' },
      { name: 'admin', kind: 'flag' },
      force,
    ],
  },
  {
    id: 'migration',
    command: 'make:migration',
    admin: false,
    fields: [
      { name: 'name', kind: 'value', code: true },
      { name: 'create', kind: 'value', code: true },
      { name: 'table', kind: 'value', code: true },
      force,
    ],
  },
];

export function generator(id: GeneratorId): Generator {
  return GENERATORS.find((g) => g.id === id)!;
}

export type Values = Record<string, string | boolean>;

/** The command's words, without `php flo`. Empty values are left out (the command's defaults). */
export function args(gen: Generator, values: Values): string[] {
  const words = [gen.command];
  const name = String(values.name ?? '').trim();
  if (name) words.push(name);
  for (const field of gen.fields) {
    if (field.name === 'name') continue;
    const value = values[field.name];
    if (field.kind === 'flag') {
      if (value === true) words.push(`--${field.name}`);
    } else {
      const text = typeof value === 'string' ? value.trim() : '';
      // The first choice is the command's default: not written
      if (text && !(field.kind === 'choice' && text === field.choices?.[0])) words.push(`--${field.name}=${text}`);
    }
  }
  return words;
}

/** The name is the one thing every generator needs. */
export function ready(values: Values): boolean {
  return String(values.name ?? '').trim() !== '';
}

/** As a person would type it: php flo make:admin-page "Sales Report" */
export function shownCommand(words: string[]): string {
  const quote = (a: string) => {
    if (!/[\s"']/.test(a)) return a;
    const option = /^(--[\w-]+=)(.*)$/.exec(a);
    const value = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
    return option ? option[1] + value(option[2] ?? '') : value(a);
  };
  return 'php flo ' + words.map(quote).join(' ');
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * The lines of a changed file (config/admin.php when a page or widget is
 * registered): what was added and removed, with a few lines around them.
 */
export function diff(before: string, after: string, context = 2): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // Too big to compare line by line: show the new file as it is
  if (a.length * b.length > 4_000_000) return b.map((text) => ({ kind: 'same', text }));
  const n = a.length;
  const m = b.length;
  const longest: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i >= n || longest[i]![j + 1]! >= longest[i + 1]![j]!)) {
      lines.push({ kind: 'added', text: b[j]! });
      j++;
    } else {
      lines.push({ kind: 'removed', text: a[i]! });
      i++;
    }
  }
  // Keep the changes and `context` lines around them
  const keep = lines.map((l, k) => l.kind !== 'same' || lines.slice(Math.max(0, k - context), k + context + 1).some((x) => x.kind !== 'same'));
  const shown: DiffLine[] = [];
  lines.forEach((line, k) => {
    if (keep[k]) shown.push(line);
    else if (keep[k - 1]) shown.push({ kind: 'same', text: '…' });
  });
  return shown;
}
