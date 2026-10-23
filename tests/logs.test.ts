import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LogLine } from '../src/api.ts';
import { classify, entries, isProblem } from '../src/logs.ts';

const server = (line: string): LogLine => ({ path: '/p', source: 'server', stream: 'err', line, at: 1 });
const log = (line: string): LogLine => ({ path: '/p', source: 'log', stream: 'out', line, at: 1 });

// Real output of `php flo serve` (PHP 8.3, flocms-cli 2.0.1, core 2.8.0)
const REAL = [
  '[OK] Serving /home/claude/sample-site at http://127.0.0.1:8123 (Ctrl+C to stop)',
  '[Fri Oct 23 03:28:39 2026] PHP 8.3.6 Development Server (http://127.0.0.1:8123) started',
  '[Fri Oct 23 03:28:41 2026] 127.0.0.1:57840 Accepted',
  '[Fri Oct 23 03:28:41 2026] 127.0.0.1:57840 Closing',
  '[Fri Oct 23 03:28:41 2026] 127.0.0.1:57846 Accepted',
  '[Fri Oct 23 03:28:41 2026] FloCMS\\Core\\HttpException: HTTP 404 in /home/claude/hostkurd/flocms-core/src/App.php:393',
  '[Fri Oct 23 03:28:41 2026] Stack trace:',
  '[Fri Oct 23 03:28:41 2026] #0 /home/claude/sample-site/public/index.php(47): FloCMS\\Core\\App::run()',
  '[Fri Oct 23 03:28:41 2026] #1 /home/claude/hostkurd/flocms-cli/resources/router.php(24): require(\'...\')',
  '[Fri Oct 23 03:28:41 2026] #2 {main}',
  '[Fri Oct 23 03:28:41 2026] 127.0.0.1:57846 Closing',
];

test('real php flo serve output', () => {
  const list = entries(REAL.map(server));
  assert.deepEqual(
    list.map((e) => e.kind),
    ['info', 'started', 'connection', 'connection', 'connection', 'notFound', 'connection'],
  );
  const notFound = list[5]!;
  assert.equal(notFound.status, 404);
  assert.equal(notFound.trace.length, 4);
  assert.equal(notFound.text.startsWith('FloCMS\\Core\\HttpException'), true);
  assert.equal(isProblem(notFound), false);
});

test('request lines (static files), PHP errors and exceptions', () => {
  const ok = classify(server('[Fri Oct 23 14:02:11 2026] 127.0.0.1:50000 [200]: GET /themes/default/style.css'));
  assert.equal(ok.kind, 'request');
  assert.equal(ok.uri, '/themes/default/style.css');
  assert.equal(classify(server('[Fri Oct 23 14:02:11 2026] 127.0.0.1:50000 [404]: GET /missing.png - No such file')).kind, 'warning');
  assert.equal(classify(server('PHP Warning:  Undefined array key "cover" in /x/views/show.html on line 14')).kind, 'warning');
  assert.equal(classify(server('PHP Fatal error:  Uncaught TypeError: x() in /y.php:3')).kind, 'exception');
  assert.equal(classify(server('PHP Parse error:  syntax error, unexpected token "}" in /a.php on line 9')).kind, 'error');
  const crash = classify(server('[Fri Oct 23 14:02:11 2026] PDOException: SQLSTATE[HY000] [2002] Connection refused in /db.php:20'));
  assert.equal(crash.kind, 'exception');
  assert.equal(isProblem(crash), true);
  assert.equal(classify(server('Port 8000 is in use.')).kind, 'info');
  // Studio's own check that the port answers
  assert.equal(
    classify(server('[Fri Oct 23 17:29:51 2026] 127.0.0.1:51484 Closed without sending a request; it was probably just an unused speculative preconnection')).kind,
    'connection',
  );
});

test('app.log levels (core Logger)', () => {
  assert.equal(classify(log('[2026-10-23 14:02:19] error: Undefined index {"type":"ErrorException"}')).kind, 'error');
  assert.equal(classify(log('[2026-10-23 14:02:19] warning: slow query')).kind, 'warning');
  assert.equal(classify(log('[2026-10-23 14:02:19] info: user signed in')).kind, 'info');
  assert.equal(classify(log('something else')).kind, 'info');
  // Real app.log line for a 404 (core 2.8 logs every HttpException as error)
  const notFound = classify(log('[2026-10-23 00:28:41] error: HTTP 404 {"type":"FloCMS\\\\Core\\\\HttpException","file":"/x/App.php","line":393}'));
  assert.equal(notFound.kind, 'notFound');
  assert.equal(isProblem(notFound), false);
  assert.equal(classify(log('[2026-10-23 00:28:41] error: HTTP 500 {"type":"FloCMS\\\\Core\\\\HttpException"}')).kind, 'error');
});
