// What Studio reads from `php flo` output (D4): JSON where the command has
// it (doctor, db:show), and the fixed text formats otherwise (admin:doctor,
// migrate:status). When a format does not match, the screens fall back to
// the command's output as it is.

export type Status = 'ok' | 'warn' | 'fail';

/** `php flo doctor --format=json` */
export interface DoctorReport {
  ok: boolean;
  failed: number;
  warnings: number;
  checks: { status: Status; check: string; detail: string }[];
}

export function parseDoctor(stdout: string): DoctorReport | null {
  try {
    const data = JSON.parse(stdout) as DoctorReport;
    return Array.isArray(data.checks) ? data : null;
  } catch {
    return null;
  }
}

/** One line of `php flo admin:doctor`: ✓ ok, ! warning, ✗ problem, or a note. */
export interface AdminLine {
  status: Status | 'note';
  text: string;
}

export interface AdminSection {
  /** null for the lines before the first section title */
  title: string | null;
  lines: AdminLine[];
}

export interface AdminReport {
  /** "flocms-admin 0.39.3" */
  heading: string | null;
  sections: AdminSection[];
  /** "Usable, with 1 warning(s)." / "1 problem(s), 0 warning(s)." */
  summary: string | null;
  problems: number;
  warnings: number;
}

export function parseAdminDoctor(stdout: string, stderr = ''): AdminReport {
  const report: AdminReport = { heading: null, sections: [], summary: null, problems: 0, warnings: 0 };
  let section: AdminSection = { title: null, lines: [] };
  const lines = stdout.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.trim()) continue;
    // A title is underlined with = (the heading) or - (a section)
    if (/^=+$/.test(next.trim()) && next.trim().length >= line.trim().length - 1) {
      report.heading = line.trim();
      i++;
      continue;
    }
    if (/^-+$/.test(next.trim()) && next.trim().length >= line.trim().length - 1) {
      if (section.title !== null || section.lines.length) report.sections.push(section);
      section = { title: line.trim(), lines: [] };
      i++;
      continue;
    }
    const mark = /^\s*(✓|!|✗)\s+(.*)$/.exec(line);
    if (mark) {
      const status: Status = mark[1] === '✓' ? 'ok' : mark[1] === '!' ? 'warn' : 'fail';
      if (status === 'warn') report.warnings++;
      if (status === 'fail') report.problems++;
      section.lines.push({ status, text: mark[2] ?? '' });
      continue;
    }
    const done = /^\s*\[OK\]\s+(.*)$/.exec(line);
    if (done) {
      report.summary = done[1] ?? null;
      continue;
    }
    section.lines.push({ status: 'note', text: line.trim() });
  }
  if (section.title !== null || section.lines.length) report.sections.push(section);
  const error = errorMessage(stderr);
  if (error) report.summary = error;
  return report;
}

/**
 * The message of a failed command (" [ERROR] text" on stderr, continued on
 * indented lines), or null.
 */
export function errorMessage(stderr: string): string | null {
  const lines = stderr.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => /^\s*\[?\s*ERROR\s*\]?\s/.test(l));
  if (start < 0) return null;
  const parts = [(lines[start] ?? '').replace(/^\s*\[?\s*ERROR\s*\]?\s+/, '').trim()];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s{2,}\S/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ');
}

/** One row of `php flo migrate:status` */
export interface Migration {
  name: string;
  package: string;
  batch: number | null;
  state: 'ran' | 'pending' | 'changed' | 'missing';
}

export function parseMigrateStatus(stdout: string): Migration[] | null {
  const rows: Migration[] = [];
  let header = false;
  for (const line of stdout.replace(/\r/g, '').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (!header) {
      header = cells[0] === 'Migration';
      if (!header) return null;
      continue;
    }
    const status = cells[3] ?? '';
    const state = status.includes('changed') ? 'changed' : status.includes('missing') ? 'missing' : status.startsWith('Ran') ? 'ran' : 'pending';
    rows.push({ name: cells[0] ?? '', package: cells[1] ?? '', batch: cells[2] ? Number(cells[2]) : null, state });
  }
  if (!header) return /No migrations found/.test(stdout) ? [] : null;
  return rows;
}

/** `php flo db:show --format=json` */
export interface DbShow {
  connection: { driver: string; database?: string; server?: string; host?: string };
  tables: { table: string; rows: number | null }[];
}

export function parseDbShow(stdout: string): DbShow | null {
  try {
    const data = JSON.parse(stdout) as DbShow;
    return Array.isArray(data.tables) ? data : null;
  } catch {
    return null;
  }
}

/** Every ASCII table (+---+ borders) in a command's output, as header -> cell rows. */
export function parseTables(stdout: string): Record<string, string>[][] {
  const tables: Record<string, string>[][] = [];
  let headers: string[] | null = null;
  let rows: Record<string, string>[] = [];
  const finish = () => {
    if (headers) tables.push(rows);
    headers = null;
    rows = [];
  };
  for (const line of stdout.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('+')) continue;
    if (!line.startsWith('|')) {
      finish();
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!headers) {
      headers = cells;
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((name, i) => (row[name] = cells[i] ?? ''));
    rows.push(row);
  }
  finish();
  return tables;
}

/** `php flo admin:list`: the admin URL of each resource's table. */
export function adminUrls(stdout: string): Record<string, string> {
  const urls: Record<string, string> = {};
  const resources = parseTables(stdout).find((rows) => rows[0] && 'Resource' in rows[0] && 'Table' in rows[0]);
  for (const row of resources ?? []) {
    if (row.Table && row.URL?.startsWith('/admin')) urls[row.Table] = row.URL;
  }
  return urls;
}
