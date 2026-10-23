// Runs a long command and shows it as it happens: the command line, its
// output, and how it ended. Used by migrations, setup, generators.

import { api, toError, type TaskExit, type TaskLine } from '../api.ts';
import { t } from '../i18n/index.ts';
import { h } from './dom.ts';
import { openDialog } from './dialog.ts';
import { errorText } from './errors.ts';

type Watch = { line(l: TaskLine): void; exit(e: TaskExit): void };
const watching = new Map<string, Watch>();
let listening: Promise<void> | null = null;

function listen(): Promise<void> {
  listening ??= Promise.all([
    api.onTaskOutput((l) => watching.get(l.id)?.line(l)),
    api.onTaskExit((e) => watching.get(e.id)?.exit(e)),
  ]).then(() => undefined);
  return listening;
}

let counter = 0;

export interface Task {
  program: 'flo' | 'composer';
  cwd: string;
  args: string[];
  stdin?: string;
  env?: [string, string][];
}

/** Lines of a terminal box, appended as they arrive. */
export class Terminal {
  readonly el = h('div', { class: 'terminal run-box', role: 'log', 'aria-live': 'polite' });

  command(text: string): void {
    this.add('› ' + text, 'cmd');
  }

  add(text: string, cls = ''): void {
    const atBottom = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 24;
    this.el.append(h('div', { class: cls }, text));
    if (atBottom) this.el.scrollTop = this.el.scrollHeight;
  }
}

/**
 * Starts a task, streaming into `terminal`. Resolves with the exit code
 * (null when it could not start or was stopped).
 */
export async function stream(task: Task, terminal: Terminal, onStart?: (cancel: () => void) => void): Promise<number | null> {
  await listen();
  const id = `task-${Date.now()}-${++counter}`;
  return new Promise((resolve) => {
    watching.set(id, {
      line: (l) => {
        // Composer and flo mark lines: show the kind of line by its look
        const cls = /^\s*\[OK\]/.test(l.line) ? 'ok' : /ERROR|\bfailed\b/i.test(l.line) && l.stream === 'err' ? 'bad' : /^\s*(!|WARNING)/.test(l.line) ? 'warn' : '';
        terminal.add(l.line, cls);
      },
      exit: (e) => {
        watching.delete(id);
        resolve(e.code);
      },
    });
    api
      .taskStart({ id, ...task })
      .then((shown) => {
        terminal.command(shown);
        onStart?.(() => void api.taskCancel(id));
      })
      .catch((error) => {
        watching.delete(id);
        terminal.add(errorText(toError(error)).replace(/`/g, ''), 'bad');
        resolve(null);
      });
  });
}

/**
 * Runs tasks one after the other in a dialog, stopping at the first that
 * fails. Resolves true when all of them succeeded.
 */
export async function runInDialog(title: string, tasks: Task[]): Promise<boolean> {
  const terminal = new Terminal();
  const status = h('div', { class: 'run-status' }, t('run.running'));
  const dialog = openDialog(title, terminal.el, status);
  let cancel: (() => void) | null = null;
  let cancelled = false;
  const stop = h('button', { type: 'button', class: 'btn', onclick: () => { cancelled = true; cancel?.(); } }, t('run.stop'));
  const close = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => dialog.close() }, t('run.close'));
  dialog.foot.append(stop, close);
  // Closing with Escape while a command runs would hide it: not allowed
  dialog.el.addEventListener('cancel', (e) => {
    if (close.disabled) e.preventDefault();
  });

  let ok = true;
  for (const task of tasks) {
    const code = await stream(task, terminal, (c) => (cancel = c));
    if (code !== 0) {
      ok = false;
      status.className = 'run-status is-bad';
      status.textContent = cancelled ? t('run.stopped') : code === null ? t('run.notStarted') : t('run.failed', { code });
      break;
    }
  }
  if (ok) {
    status.className = 'run-status is-ok';
    status.textContent = t('run.done');
  }
  stop.remove();
  close.disabled = false;
  close.focus();
  return ok;
}
