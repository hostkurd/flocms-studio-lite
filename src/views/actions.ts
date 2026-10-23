// Commands the screens run on a project, with the questions Studio asks
// first: on a production site (APP_ENV=production) the CLI refuses without
// --force when nobody can answer, so Studio asks and then adds --force.

import type { ProjectInfo } from '../api.ts';
import { loadChecks } from '../checks.ts';
import { t } from '../i18n/index.ts';
import { loadInfo } from '../state.ts';
import { h, rich } from '../ui/dom.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { runInDialog } from '../ui/runner.ts';

/** Commands that change data and refuse on production without --force. */
const ASKS_ON_PRODUCTION = new Set(['migrate', 'migrate:rollback', 'migrate:fresh', 'db:seed']);

export function isProduction(info: ProjectInfo): boolean {
  return (info.appEnv ?? '').toLowerCase() === 'production';
}

/**
 * Runs `php flo <args>` in a dialog. Asks first on production for the
 * commands that change data. Afterwards the project's details and checks
 * are read again.
 */
export async function runFlo(info: ProjectInfo, title: string, args: string[]): Promise<boolean> {
  const command = args[0] ?? '';
  let final = args;
  if (ASKS_ON_PRODUCTION.has(command) && isProduction(info) && !args.includes('--force')) {
    const yes = await confirmDialog({
      title: t('db.production.title'),
      text: h('p', null, rich(t('db.production.text', { command: 'php flo ' + args.join(' ') }))),
      action: t('db.production.action'),
      danger: true,
    });
    if (!yes) return false;
    final = [...args, '--force'];
  }
  const ok = await runInDialog(title, [{ program: 'flo', cwd: info.path, args: final }]);
  await loadInfo(info.path);
  loadChecks(info, true);
  return ok;
}
