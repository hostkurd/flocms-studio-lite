// Reading the lines of `php flo serve` (PHP's built-in server) and of
// storage/logs/app.log (core's Logger: "[date] level: message").
// Lines that match nothing are shown as they are: nothing is ever hidden
// except the connection lines, and only while that filter is on.

import type { LogLine } from './api.ts';

export type Kind =
  | 'connection' // "127.0.0.1:51234 Accepted" / "Closing"
  | 'started' // "PHP 8.3.6 Development Server (http://…) started"
  | 'request' // "127.0.0.1:51234 [200]: GET /style.css"
  | 'notFound' // an HttpException 404 the router reported
  | 'exception' // "FloCMS\Core\Foo: message in file:line"
  | 'error' // PHP errors, log level error and above
  | 'warning'
  | 'info';

export interface Entry {
  kind: Kind;
  source: LogLine['source'];
  at: number;
  /** The line without the server's date prefix */
  text: string;
  status?: number;
  method?: string;
  uri?: string;
  /** Stack trace lines that followed an exception */
  trace: string[];
}

const SERVER_DATE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \w{3} +\d+ \d\d:\d\d:\d\d \d{4}\] /;
const CONNECTION = /^\S+:\d+ (?:Accepted|Closing|Closed without sending a request\b.*)$/;
const STARTED = /^PHP \S+ Development Server \(.+\) started$/;
const REQUEST = /^\S+:\d+ \[(\d{3})\]: ([A-Z]+) (\S+)/;
const EXCEPTION = /^(?:PHP Fatal error: {2}Uncaught )?([A-Za-z_\\][\w\\]*(?:Exception|Error)): (.*)$/;
const PHP_PROBLEM = /^(?:PHP )?(Fatal error|Parse error|Warning|Notice|Deprecated|Recoverable fatal error)\b/;
const TRACE = /^(?:Stack trace:|#\d+ |\s+thrown in |Next [A-Za-z\\])/;
const APP_LOG = /^\[[^\]]+\] (\w+): /;

export function classify(line: LogLine): Entry {
  const base = { source: line.source, at: line.at, trace: [] as string[] };
  if (line.source === 'log') {
    const level = APP_LOG.exec(line.line)?.[1]?.toLowerCase();
    // Core logs every HttpException, 404s included: those are not problems
    const http = /^\[[^\]]+\] \w+: HTTP (\d{3})\b/.exec(line.line);
    if (http && Number(http[1]) < 500 && line.line.includes('HttpException')) {
      return { ...base, kind: 'notFound', text: line.line, status: Number(http[1]) };
    }
    const kind: Kind =
      level && ['emergency', 'alert', 'critical', 'error'].includes(level)
        ? 'error'
        : level === 'warning'
          ? 'warning'
          : 'info';
    return { ...base, kind, text: line.line };
  }
  const text = line.line.replace(SERVER_DATE, '');
  if (CONNECTION.test(text)) return { ...base, kind: 'connection', text };
  if (STARTED.test(text)) return { ...base, kind: 'started', text };
  const request = REQUEST.exec(text);
  if (request) {
    const status = Number(request[1]);
    return {
      ...base,
      kind: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'request',
      text,
      status,
      method: request[2],
      uri: request[3],
    };
  }
  const exception = EXCEPTION.exec(text);
  if (exception) {
    const http = /^HTTP (\d{3})\b/.exec(exception[2] ?? '');
    if (exception[1]?.endsWith('HttpException') && http && Number(http[1]) < 500) {
      return { ...base, kind: 'notFound', text, status: Number(http[1]) };
    }
    return { ...base, kind: 'exception', text };
  }
  const problem = PHP_PROBLEM.exec(text);
  if (problem) {
    const severe = /fatal|parse/i.test(problem[1] ?? '');
    return { ...base, kind: severe ? 'error' : 'warning', text };
  }
  return { ...base, kind: 'info', text };
}

/** Lines into entries: stack traces join the exception before them. */
export function entries(lines: readonly LogLine[]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    const text = line.line.replace(SERVER_DATE, '');
    const last = out[out.length - 1];
    if (line.source === 'server' && TRACE.test(text) && last && (last.kind === 'exception' || last.kind === 'notFound' || last.trace.length)) {
      last.trace.push(text);
      continue;
    }
    if (line.line.trim() === '' && line.source === 'log') continue;
    out.push(classify(line));
  }
  return out;
}

export function isProblem(entry: Entry): boolean {
  return entry.kind === 'error' || entry.kind === 'exception' || entry.kind === 'warning';
}

/** 14:02:11, in the computer's time. */
export function clock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
