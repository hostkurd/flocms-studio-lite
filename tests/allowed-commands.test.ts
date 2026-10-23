import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { plan, type WizardInput } from '../src/wizard-plan.ts';

// The Rust side runs only the commands in src-tauri/src/tasks.rs. Every
// command the screens use must be in that list (a missing db:check once
// stopped the wizard).
const rust = readFileSync(new URL('../src-tauri/src/tasks.rs', import.meta.url), 'utf8');
const list = (name: string) => [...(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(rust)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
const flo = list('FLO_COMMANDS');
const floPrefixes = list('FLO_PREFIXES');
const composer = list('COMPOSER_COMMANDS');
const floAllowed = (c: string) => flo.includes(c) || floPrefixes.some((p) => c.startsWith(p));

test('the lists were read', () => {
  assert.ok(flo.includes('migrate') && composer.includes('create-project'));
});

test('every command in the wizard is allowed', () => {
  const inputs: WizardInput[] = (['site-admin', 'site', 'admin', 'api-admin', 'api'] as const).map((setup) => ({
    name: 'x', parent: '/p', languages: ['en'], defaultLanguage: 'en', setup, addApi: true,
    database: { type: 'sqlite' }, admin: { name: 'A', email: 'a@b.c', password: '12345678' }, appUrl: 'http://127.0.0.1:8000',
  }));
  for (const input of inputs) {
    for (const step of plan(input)) {
      if (step.kind === 'flo') assert.ok(floAllowed(step.args[0]!), `php flo ${step.args[0]}`);
      if (step.kind === 'composer') assert.ok(composer.includes(step.args[0]!), `composer ${step.args[0]}`);
    }
  }
});

test('every php flo command the screens run is allowed', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = ['checks.ts', ...readdirSync(new URL('views/', dir)).map((f) => 'views/' + f)];
  const used = new Set<string>();
  for (const file of files) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    // capture(path, ['doctor', …]), runFlo(info, title, ['migrate']), args: ['cache:clear']
    for (const m of text.matchAll(/(?:capture\([^,]+,|runFlo\([^\[]+|args: |quick\([^,]+,)\s*\[\s*'([a-z][\w:-]*)'/g)) used.add(m[1]!);
  }
  assert.ok(used.size >= 8, [...used].join(' '));
  for (const command of used) assert.ok(floAllowed(command), `php flo ${command}`);
});
