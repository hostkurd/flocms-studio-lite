import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTargets, projectType, urlFor } from '../src/project-type.ts';

const p = (home: 'site' | 'admin' | 'api', hasAdmin: boolean, hasApi: boolean) => ({ home, hasAdmin, hasApi });

test('the five setups, and a website that added the API', () => {
  assert.equal(projectType(p('site', true, false)), 'siteAdmin');
  assert.equal(projectType(p('site', false, false)), 'site');
  assert.equal(projectType(p('admin', true, false)), 'admin');
  assert.equal(projectType(p('admin', true, true)), 'apiAdmin');
  assert.equal(projectType(p('api', false, true)), 'api');
  assert.equal(projectType(p('site', false, true)), 'siteApi');
  assert.equal(projectType(p('site', true, true)), 'siteAdminApi');
});

test('admin-only and API-only projects have no Open site', () => {
  assert.deepEqual(openTargets(p('admin', true, false)), { site: false, admin: true, api: false });
  assert.deepEqual(openTargets(p('api', false, true)), { site: false, admin: false, api: true });
  assert.deepEqual(openTargets(p('site', true, true)), { site: true, admin: true, api: true });
});

test('addresses', () => {
  assert.equal(urlFor('http://127.0.0.1:8000/', 'site', 'en'), 'http://127.0.0.1:8000/');
  assert.equal(urlFor('http://127.0.0.1:8000', 'admin', 'ar'), 'http://127.0.0.1:8000/ar/admin');
  assert.equal(urlFor('http://127.0.0.1:8001', 'api', null), 'http://127.0.0.1:8001/api/v1/health');
});
