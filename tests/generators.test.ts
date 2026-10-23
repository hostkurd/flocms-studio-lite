import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENERATORS, args, diff, generator, ready, shownCommand } from '../src/generators.ts';

test('an admin resource with the board 3 answers', () => {
  const words = args(generator('resource'), { name: 'Property', table: 'properties', slug: 'listings', form: 'page', migration: true, reorderable: false });
  assert.deepEqual(words, ['make:admin-resource', 'Property', '--table=properties', '--slug=listings', '--migration']);
  assert.equal(shownCommand(words), 'php flo make:admin-resource Property --table=properties --slug=listings --migration');
});

test('a choice other than the default, and names with spaces', () => {
  assert.deepEqual(args(generator('resource'), { name: 'Post', form: 'slide-over' }), ['make:admin-resource', 'Post', '--form=slide-over']);
  assert.deepEqual(args(generator('widget'), { name: 'Recent', type: 'records', resource: ' Post ' }), ['make:admin-widget', 'Recent', '--type=records', '--resource=Post']);
  assert.equal(shownCommand(['make:admin-page', 'SalesReport', '--group=Sales reports']), 'php flo make:admin-page SalesReport --group="Sales reports"');
});

test('the name is needed', () => {
  assert.equal(ready({ name: '  ' }), false);
  assert.equal(ready({ name: 'Blog' }), true);
});

test('every generator is a make: command with a name', () => {
  for (const gen of GENERATORS) {
    assert.ok(gen.command.startsWith('make:'));
    assert.equal(gen.fields[0]?.name, 'name');
  }
});

test('the diff of a registration in config/admin.php', () => {
  const before = ['<?php', 'return [', "    'pages' => [", '    ],', '];'].join('\n');
  const after = ['<?php', 'return [', "    'pages' => [", '        SalesReport::class,', '    ],', '];'].join('\n');
  const lines = diff(before, after, 1);
  assert.deepEqual(lines, [
    { kind: 'same', text: "    'pages' => [" },
    { kind: 'added', text: '        SalesReport::class,' },
    { kind: 'same', text: '    ],' },
    { kind: 'same', text: '…' },
  ]);
});
