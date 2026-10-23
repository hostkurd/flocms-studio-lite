import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { adminUrls, errorMessage, parseAdminDoctor, parseDbShow, parseDoctor, parseMigrateStatus, parseTables } from '../src/flo-output.ts';

// Real outputs (flocms-cli 2.0.1, flocms-admin 0.39.3, skeleton 2.0.0, SQLite)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('php flo doctor --format=json', () => {
  const report = parseDoctor(fixture('doctor.json'))!;
  assert.equal(report.ok, true);
  assert.equal(report.warnings, 1);
  assert.equal(report.checks.length, 23);
  assert.deepEqual(report.checks.find((c) => c.status === 'warn'), { status: 'warn', check: 'storage/cache/', detail: 'missing' });
  assert.equal(parseDoctor('not json'), null);
});

test('php flo admin:doctor', () => {
  const report = parseAdminDoctor(fixture('admin-doctor.txt'));
  assert.equal(report.heading, 'flocms-admin 0.39.3');
  assert.equal(report.summary, 'Usable, with 1 warning(s).');
  assert.equal(report.warnings, 1);
  assert.equal(report.problems, 0);
  const first = report.sections[0]!;
  assert.equal(first.title, null);
  assert.deepEqual(first.lines[0], { status: 'ok', text: 'config/admin.php found' });
  assert.deepEqual(first.lines.at(-1), { status: 'warn', text: 'No resources yet: php flo make:admin-resource Post --migration' });
  const media = report.sections.find((s) => s.title?.startsWith('Media library'))!;
  assert.ok(media.lines.some((l) => l.status === 'note' && l.text.startsWith('Permissions:')));
  assert.ok(report.sections.some((s) => s.title === 'Pages  (/admin/site-pages)'));
});

test('admin:doctor problems and a failed run', () => {
  const report = parseAdminDoctor('\nflocms-admin 0.39.3\n===================\n\n  ✓ config/admin.php found\n  ✗ Table "posts" not found (run php flo migrate?)\n\n', ' ERROR  1 problem(s), 0 warning(s).\n');
  assert.equal(report.problems, 1);
  assert.equal(report.summary, '1 problem(s), 0 warning(s).');
  const missing = parseAdminDoctor('', ' [ERROR] config/admin.php not found: run php flo admin:install\n');
  assert.equal(missing.summary, 'config/admin.php not found: run php flo admin:install');
});

test('php flo migrate:status', () => {
  const rows = parseMigrateStatus(fixture('migrate-status.txt'))!;
  assert.ok(rows.length >= 3);
  assert.deepEqual(rows[0], { name: '2026_10_10_000000_create_users_table', package: 'app', batch: 1, state: 'ran' });
  const mixed = parseMigrateStatus(
    [
      '+------+---------------------+-------+---------------------+',
      '| Migration | Package | Batch | Status |',
      '+------+---------------------+-------+---------------------+',
      '| 2026_10_10_000000_create_api_tables | hostkurd/flocms-api | 1 | Ran |',
      '| 2026_10_15_093000_create_properties_table | app | 4 | Ran (changed since) |',
      '| 2026_10_15_093001_old | app | 4 | Ran (file missing) |',
      '| 2026_10_22_140500_add_featured | app |  | Pending |',
      '+------+---------------------+-------+---------------------+',
      '1 pending; run "php flo migrate".',
    ].join('\n'),
  )!;
  assert.deepEqual(
    mixed.map((m) => m.state),
    ['ran', 'changed', 'missing', 'pending'],
  );
  assert.equal(mixed[3]!.batch, null);
  assert.equal(mixed[0]!.package, 'hostkurd/flocms-api');
  assert.deepEqual(parseMigrateStatus('No migrations found in database/migrations or in installed packages.\n'), []);
  assert.equal(parseMigrateStatus('something else'), null);
});

test('php flo db:show --format=json and errors', () => {
  const db = parseDbShow(fixture('db-show.json'))!;
  assert.equal(db.connection.driver, 'sqlite');
  assert.ok(db.tables.some((t) => t.table === 'users'));
  assert.equal(
    errorMessage('\n [ERROR] Cannot connect to the database (127.0.0.1:3306/shop): SQLSTATE[HY000] [2002] Connection refused\n         Is MySQL/MariaDB running (XAMPP: start MySQL) and are DB_HOST/DB_PORT right?\n\n'),
    'Cannot connect to the database (127.0.0.1:3306/shop): SQLSTATE[HY000] [2002] Connection refused Is MySQL/MariaDB running (XAMPP: start MySQL) and are DB_HOST/DB_PORT right?',
  );
  assert.equal(errorMessage(''), null);
});

test('php flo admin:list: the admin URL of each table', () => {
  assert.deepEqual(adminUrls(fixture('admin-list.txt')), { users: '/admin/accounts', media: '/admin/media' });
  assert.equal(parseTables(fixture('admin-list.txt')).length, 2);
});
