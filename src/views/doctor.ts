// The Doctor tab (board 7): `php flo doctor` with translated check names and
// the details as the command wrote them; `php flo admin:doctor` line by line.

import type { ProjectInfo } from '../api.ts';
import { checksFor, runDoctor } from '../checks.ts';
import type { AdminLine, AdminReport, DoctorReport, Status } from '../flo-output.ts';
import { relativeTime, t, type Key } from '../i18n/index.ts';
import { h, ltr, rich } from '../ui/dom.ts';
import { icon } from '../ui/icons.ts';

/** php flo doctor's check names (flocms-cli DoctorCommand), translated. */
const CHECK_NAMES: Record<string, Key> = {
  'PHP version': 'check.php',
  'Composer dependencies': 'check.composer',
  '.env file': 'check.envFile',
  '.env keys': 'check.envKeys',
  APP_KEY: 'check.appKey',
  APP_URL: 'check.appUrl',
  HTTPS: 'check.https',
  APP_DEBUG: 'check.appDebug',
  Database: 'check.database',
  Migrations: 'check.migrations',
  'public/.htaccess': 'check.htaccess',
  'Document root': 'check.docroot',
  'Maintenance mode': 'check.maintenance',
};

/** The check's name in the reader's language; unknown names stay as written. */
export function checkName(check: string): Node[] {
  const key = CHECK_NAMES[check];
  if (key) return rich(t(key));
  const extension = /^Extension (\S+)$/.exec(check);
  if (extension) return rich(t('check.extension', { name: extension[1] ?? '' }));
  if (/^[\w./-]+\/$/.test(check)) return rich(t('check.folder', { name: check }));
  return [ltr(check)];
}

export function statusIcon(status: Status | 'note', size = 18): Node {
  if (status === 'ok') return icon('check', size, 'is-ok');
  if (status === 'warn') return icon('warn', size, 'is-warn');
  if (status === 'fail') return icon('cross', size, 'is-bad');
  return h('span', { class: 'icon-space', style: `width:${size}px` });
}

const ORDER: Record<Status, number> = { fail: 0, warn: 1, ok: 2 };

export function doctorTab(info: ProjectInfo): HTMLElement {
  const c = checksFor(info.path);
  const counts = { fail: 0, warn: 0, ok: 0 };
  for (const check of c.doctor?.checks ?? []) counts[check.status]++;
  for (const section of c.admin?.sections ?? []) for (const line of section.lines) if (line.status !== 'note') counts[line.status]++;

  const head = h(
    'div',
    { class: 'page-head', style: 'align-items:center' },
    h(
      'div',
      { class: 'actions', style: 'align-items:center' },
      counts.fail ? h('span', { class: 'pill is-bad pill-lg' }, t('doctor.countProblems', { count: counts.fail })) : null,
      counts.warn ? h('span', { class: 'pill is-warn pill-lg' }, t('doctor.countWarnings', { count: counts.warn })) : null,
      c.doctorAt && (c.doctor || c.admin) ? h('span', { class: 'pill is-ok pill-lg' }, t('doctor.countOk', { count: counts.ok })) : null,
      c.doctorAt ? h('span', { class: 'hint' }, t('doctor.lastRun', { time: relativeTime(c.doctorAt) })) : null,
    ),
    h(
      'button',
      { type: 'button', class: 'btn', disabled: c.doctorLoading || !info.hasVendor, onclick: () => void runDoctor(info) },
      icon('refresh', 14),
      c.doctorLoading ? t('doctor.running') : t('doctor.runAgain'),
    ),
  );

  if (!info.hasVendor) {
    return h('div', { class: 'stack' }, head, h('div', { class: 'notice is-warn' }, icon('warn', 18), h('span', null, rich(t('doctor.noVendor')))));
  }

  return h(
    'div',
    { class: 'stack' },
    head,
    h(
      'div',
      { class: 'cards-wide' },
      frameworkCard(c.doctor, c.doctorOutput?.stdout ?? '', c.doctorOutput?.stderr ?? '', c.doctorLoading),
      info.hasAdmin ? adminCard(c.admin, c.adminOutput?.stdout ?? '', c.adminOutput?.stderr ?? '', c.doctorLoading) : null,
    ),
  );
}

function frameworkCard(report: DoctorReport | null, stdout: string, stderr: string, loading: boolean): HTMLElement {
  const body: Node[] = [];
  if (!report) {
    body.push(loading ? h('p', { class: 'muted' }, t('doctor.running')) : rawOutput(stdout, stderr, true));
  } else {
    const sorted = [...report.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const attention = sorted.filter((c) => c.status !== 'ok');
    const passed = sorted.filter((c) => c.status === 'ok');
    for (const check of attention) body.push(checkRow(check.status, checkName(check.check), check.detail));
    if (!attention.length) body.push(h('div', { class: 'hint is-ok' }, t('doctor.allPassed')));
    body.push(
      h(
        'details',
        { class: 'more' },
        h('summary', null, t('doctor.passed', { count: passed.length })),
        h('div', { class: 'rows' }, passed.map((check) => checkRow('ok', checkName(check.check), check.detail))),
      ),
    );
  }
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('doctor.framework')), ltr('php flo doctor', 'mono muted')),
    body,
  );
}

function checkRow(status: Status, name: Node[], detail: string): HTMLElement {
  return h(
    'div',
    { class: 'check-row' },
    h('span', { class: 'check-name' }, statusIcon(status), h('span', null, name)),
    h('bdi', { class: 'check-detail mono', dir: 'ltr' }, detail),
  );
}

function adminCard(report: AdminReport | null, stdout: string, stderr: string, loading: boolean): HTMLElement {
  const body: Node[] = [];
  if (!report) {
    body.push(loading ? h('p', { class: 'muted' }, t('doctor.running')) : rawOutput(stdout, stderr, true));
  } else {
    // Problems and warnings first, each with its section; then everything
    const attention: HTMLElement[] = [];
    for (const section of report.sections) {
      for (const line of section.lines) {
        if (line.status === 'fail' || line.status === 'warn') attention.push(adminRow(line, section.title));
      }
    }
    body.push(...attention);
    if (report.summary) body.push(h('div', { class: 'hint ' + (report.problems ? 'is-bad' : report.warnings ? 'is-warn' : 'is-ok'), dir: 'ltr', style: 'text-align:start' }, ltr(report.summary)));
    body.push(
      h(
        'details',
        { class: 'more' },
        h('summary', null, t('doctor.allLines')),
        report.sections.map((section) =>
          h(
            'div',
            { class: 'admin-section' },
            section.title ? h('div', { class: 'label' }, ltr(section.title)) : null,
            section.lines.map((line) => adminRow(line, null)),
          ),
        ),
      ),
    );
    body.push(rawOutput(stdout, stderr, false));
  }
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('doctor.admin')), ltr('php flo admin:doctor', 'mono muted')),
    body,
  );
}

/** admin:doctor writes free English sentences: shown as they are, left to right. */
function adminRow(line: AdminLine, section: string | null): HTMLElement {
  return h(
    'div',
    { class: 'check-row admin-line is-' + line.status },
    h(
      'span',
      { class: 'check-name', dir: 'ltr' },
      statusIcon(line.status),
      h('span', null, section ? h('span', { class: 'muted' }, section.replace(/\s{2,}\(.*\)$/, '') + ': ') : null, line.text),
    ),
  );
}

function rawOutput(stdout: string, stderr: string, open: boolean): HTMLElement {
  const text = (stdout + (stderr ? '\n' + stderr : '')).trim();
  return h(
    'details',
    { class: 'more', open },
    h('summary', null, open ? t('doctor.unreadable') : t('doctor.fullOutput')),
    h('div', { class: 'terminal', style: 'max-height:360px' }, text || '—'),
  );
}
