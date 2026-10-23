import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import { formatNumber, resolveLanguage, setLanguage, t } from '../src/i18n/index.ts';
import { ku } from '../src/i18n/ku.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has every key, with the same placeholders', () => {
  for (const [name, dict] of Object.entries({ ar, ku })) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), name);
    for (const [key, text] of Object.entries(en)) {
      assert.deepEqual(placeholders((dict as Record<string, string>)[key]!), placeholders(text), `${name} ${key}`);
      assert.notEqual((dict as Record<string, string>)[key]!.trim(), '', `${name} ${key} is empty`);
    }
  }
});

test('the system language picks Arabic, Kurdish or English', () => {
  assert.equal(resolveLanguage('system', ['ar-IQ', 'en']), 'ar');
  assert.equal(resolveLanguage('system', ['ckb-IQ']), 'ku');
  assert.equal(resolveLanguage('system', ['ku']), 'ku');
  assert.equal(resolveLanguage('system', ['el-GR', 'en-US']), 'en');
  assert.equal(resolveLanguage('system', ['fr']), 'en');
  assert.equal(resolveLanguage('ar', ['en']), 'ar');
});

test('t() fills placeholders and formats numbers per language', () => {
  setLanguage('en');
  assert.equal(t('packages.other', { count: 14 }), 'Other packages (14)');
  setLanguage('ar');
  assert.equal(formatNumber(24), '٢٤');
  assert.match(t('packages.other', { count: 3 }), /٣/);
  setLanguage('en');
  assert.equal(t('error.io'), 'Something went wrong: {detail}');
});

test('code parts (backticks) match the English ones', () => {
  const code = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
  for (const [name, dict] of Object.entries({ ar, ku })) {
    for (const [key, text] of Object.entries(en)) {
      assert.deepEqual(code((dict as Record<string, string>)[key]!), code(text), `${name} ${key}`);
    }
  }
});
