import type { StudioError } from '../api.ts';
import { hasKey, t } from '../i18n/index.ts';

/** A StudioError in the reader's language. */
export function errorText(error: StudioError): string {
  const key = `error.${error.code}`;
  return hasKey(key) ? t(key, { detail: error.detail }) : t('error.io', { detail: error.detail || error.code });
}
