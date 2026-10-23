import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appName, hasApi, joinPath, plan, shown, validLanguage, validName, type WizardInput } from '../src/wizard-plan.ts';

const base: WizardInput = {
  name: 'ar-lighting',
  parent: '/Users/me/Sites',
  languages: ['en', 'ar', 'ku'],
  defaultLanguage: 'en',
  setup: 'site-admin',
  addApi: false,
  database: { type: 'sqlite' },
  admin: { name: 'Site Admin', email: 'admin@example.com', password: 'secret123' },
  appUrl: 'http://127.0.0.1:8000',
};

test('website + admin with SQLite', () => {
  const steps = plan(base).map(shown);
  assert.deepEqual(steps, [
    'composer create-project hostkurd/flocms ar-lighting',
    'Write .env: APP_NAME, SITE_NAME, APP_URL, LANGUAGES, DEFAULT_LANG, DB_TYPE, DB_NAME',
    'php flo setup --as=site-admin',
    'php flo db:check',
    'php flo migrate',
    'php flo user:create --name="Site Admin" --email=admin@example.com --role=super-admin --password-stdin',
  ]);
  const user = plan(base).at(-1)!;
  assert.equal(user.kind === 'flo' && user.stdin, 'secret123');
  assert.ok(!steps.join(' ').includes('secret123'), 'the password is never shown');
});

test('the API added to a website, and API only', () => {
  const site = plan({ ...base, setup: 'site', addApi: true, admin: null }).map(shown);
  assert.ok(site.includes('composer require hostkurd/flocms-api:^1.3'));
  assert.ok(site.includes('php flo api:install'));
  assert.ok(!site.some((s) => s.startsWith('php flo user:create')));
  // setup adds the API itself; the checkbox only counts for the website setups
  const api = plan({ ...base, setup: 'api', addApi: true, admin: null }).map(shown);
  assert.ok(!api.includes('composer require hostkurd/flocms-api:^1.3'));
  assert.equal(hasApi({ setup: 'api', addApi: false }), true);
  assert.equal(hasApi({ setup: 'admin', addApi: true }), false);
});

test('MySQL settings in .env', () => {
  const env = plan({ ...base, database: { type: 'mysql', host: '127.0.0.1', port: '3306', name: 'ar_lighting', user: 'root', password: '' } })[1]!;
  assert.equal(env.kind, 'env');
  assert.deepEqual(env.kind === 'env' ? env.values.slice(5) : [], [
    ['DB_TYPE', 'mysql'],
    ['DB_HOST', '127.0.0.1'],
    ['DB_PORT', '3306'],
    ['DB_NAME', 'ar_lighting'],
    ['DB_USERNAME', 'root'],
    ['DB_PASSWORD', ''],
  ]);
});

test('names, languages and paths', () => {
  assert.ok(validName('fectum-hellas'));
  assert.ok(!validName('Fectum'));
  assert.ok(!validName('-x'));
  assert.ok(!validName('a b'));
  assert.ok(validLanguage('el'));
  assert.ok(!validLanguage('EN'));
  assert.equal(appName('fectum-hellas'), 'Fectum Hellas');
  assert.equal(joinPath('C:\\Sites\\', 'shop'), 'C:\\Sites\\shop');
  assert.equal(joinPath('/Users/me/Sites', 'shop'), '/Users/me/Sites/shop');
});
