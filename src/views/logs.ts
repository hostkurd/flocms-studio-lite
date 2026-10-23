// The Logs tab: the server's output and storage/logs/app.log, live.

import { api, type LogLine, type ProjectInfo } from '../api.ts';
import { t } from '../i18n/index.ts';
import { clock, entries, isProblem, type Entry } from '../logs.ts';
import { clearLogs, logsFor, onLog, state } from '../state.ts';
import { clear, h } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';
import { run, serverButton } from './project.ts';

// What the reader chose, kept while Studio is open
const options = { problemsOnly: false, connections: false, follow: true };

export function logsTab(info: ProjectInfo): HTMLElement {
  const path = info.path;
  const box = h('div', { class: 'terminal log-box', role: 'log', 'aria-live': 'off', tabindex: '0' });
  const lines: LogLine[] = [...logsFor(path)];

  function visible(entry: Entry): boolean {
    if (entry.kind === 'connection' && !options.connections) return false;
    if (options.problemsOnly && !isProblem(entry)) return false;
    return true;
  }

  function draw(): void {
    clear(box);
    const list = entries(lines).filter(visible);
    if (!list.length) {
      box.append(h('div', { class: 'dim' }, state.servers[path] ? t('logs.empty') : t(lines.length ? 'logs.stopped' : 'logs.empty')));
    }
    for (const entry of list) box.append(entryNode(entry));
    if (options.follow) box.scrollTop = box.scrollHeight;
  }

  // New lines: redraw at most a few times a second. Once the tab is gone
  // from the window (another tab, another project), stop listening.
  let pending = false;
  let shown = false;
  const stop = onLog((line) => {
    if (shown && !box.isConnected) {
      stop();
      return;
    }
    if (line.path !== path) return;
    lines.push(line);
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (box.isConnected) draw();
    }, 150);
  });

  box.addEventListener('scroll', () => {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    if (atBottom !== options.follow) {
      options.follow = atBottom;
      followBox.checked = atBottom;
    }
  });

  const seg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': t('logs.filter') },
    h('button', { type: 'button', 'aria-pressed': String(!options.problemsOnly), onclick: () => setProblems(false) }, t('logs.all')),
    h('button', { type: 'button', 'aria-pressed': String(options.problemsOnly), onclick: () => setProblems(true) }, t('logs.problems')),
  );
  function setProblems(on: boolean): void {
    options.problemsOnly = on;
    const [all, problems] = seg.children;
    all?.setAttribute('aria-pressed', String(!on));
    problems?.setAttribute('aria-pressed', String(on));
    draw();
  }

  const connectionsBox = h('input', { type: 'checkbox', checked: options.connections, onchange: (e) => { options.connections = (e.target as HTMLInputElement).checked; draw(); } });
  const followBox = h('input', { type: 'checkbox', checked: options.follow, onchange: (e) => { options.follow = (e.target as HTMLInputElement).checked; if (options.follow) box.scrollTop = box.scrollHeight; } });
  const logsDir = path + (path.includes('\\') ? '\\storage\\logs' : '/storage/logs');

  const el = h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'actions', style: 'align-items:center' }, seg, h('label', { class: 'check-inline' }, connectionsBox, t('logs.connections')), h('label', { class: 'check-inline' }, followBox, t('logs.follow'))),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(api.openFolder(logsDir)) }, icon('folder', 14), t('logs.openLogs')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => run(clearLogs(path).then(() => { lines.length = 0; draw(); })) }, t('logs.clear')),
        state.servers[path] ? null : serverButton(path, true),
      ),
    ),
    box,
  );
  draw();
  // The first draw happens before the box is on screen: scroll once it is
  requestAnimationFrame(() => {
    shown = box.isConnected;
    if (options.follow) box.scrollTop = box.scrollHeight;
  });
  return el;
}

function entryNode(entry: Entry): HTMLElement {
  const time = h('span', { class: 'dim' }, clock(entry.at) + ' ');
  const source = entry.source === 'log' ? h('span', { class: 'tag' }, t('logs.appLog')) : null;
  const cls = entry.kind === 'error' || entry.kind === 'exception' ? 'bad' : entry.kind === 'warning' ? 'warn' : entry.kind === 'request' || entry.kind === 'started' ? 'ok' : entry.kind === 'connection' || entry.kind === 'notFound' ? 'dim' : '';
  const line = h('div', { class: 'log-line' }, time, source, h('span', { class: cls }, entry.text));
  if (!entry.trace.length) return line;
  return h(
    'details',
    { class: 'log-trace' },
    h('summary', null, line, ' ', h('bdi', { class: 'dim', dir: 'auto' }, t('logs.trace', { count: entry.trace.length }))),
    h('div', { class: 'dim', style: 'padding-inline-start:2ch' }, entry.trace.map((l) => h('div', null, l))),
  );
}

