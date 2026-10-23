// What a project is, from its 'home' setting and its packages. Matches the
// five `php flo setup` choices, plus a website that added the API itself.

import type { Key } from './i18n/index.ts';
import type { ProjectSummary } from './api.ts';

export type ProjectType = 'site' | 'siteAdmin' | 'siteApi' | 'siteAdminApi' | 'admin' | 'apiAdmin' | 'api';

export function projectType(p: Pick<ProjectSummary, 'home' | 'hasAdmin' | 'hasApi'>): ProjectType {
  if (p.home === 'api') return p.hasAdmin ? 'apiAdmin' : 'api';
  if (p.home === 'admin') return p.hasApi ? 'apiAdmin' : 'admin';
  if (p.hasAdmin && p.hasApi) return 'siteAdminApi';
  if (p.hasAdmin) return 'siteAdmin';
  if (p.hasApi) return 'siteApi';
  return 'site';
}

export function typeKey(type: ProjectType): Key {
  return `type.${type}` as Key;
}

/** Which "Open …" buttons the project gets. */
export function openTargets(p: Pick<ProjectSummary, 'home' | 'hasAdmin' | 'hasApi'>): {
  site: boolean;
  admin: boolean;
  api: boolean;
} {
  return {
    site: p.home === 'site',
    admin: p.hasAdmin,
    api: p.hasApi,
  };
}

/** The address of a part of the site, from the server's base URL. */
export function urlFor(base: string, target: 'site' | 'admin' | 'api', language: string | null): string {
  const root = base.replace(/\/+$/, '');
  if (target === 'admin') return `${root}/${language || 'en'}/admin`;
  if (target === 'api') return `${root}/api/v1/health`;
  return `${root}/`;
}
