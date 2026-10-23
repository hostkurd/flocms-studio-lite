import { ar } from './ar.ts';
import { en, type Key } from './en.ts';
import { ku } from './ku.ts';

export type Language = 'en' | 'ar' | 'ku';
export type { Key };

const dictionaries: Record<Language, Record<Key, string>> = { en, ar, ku };

/** The HTML lang value: Kurdish is Central Kurdish (Sorani), "ckb". */
export const HTML_LANG: Record<Language, string> = { en: 'en', ar: 'ar', ku: 'ckb' };
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', ar: 'العربية', ku: 'کوردی' };

let current: Language = 'en';

export function language(): Language {
  return current;
}

export function isRtl(lang: Language = current): boolean {
  return lang === 'ar' || lang === 'ku';
}

/** "system" picks from the operating system's language list. */
export function resolveLanguage(setting: string, preferred: readonly string[]): Language {
  if (setting === 'en' || setting === 'ar' || setting === 'ku') {
    return setting;
  }
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    if (base === 'ar') return 'ar';
    if (base === 'ckb' || base === 'ku') return 'ku';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function setLanguage(lang: Language): void {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = HTML_LANG[lang];
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
}

/** The text for key in the current language, with {name} filled in. */
export function t(key: Key, params: Record<string, string | number> = {}): string {
  const text = dictionaries[current][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? formatNumber(value) : value;
  });
}

/** Counts in the reader's digits: ٢٤ in Arabic and Kurdish. */
export function formatNumber(value: number): string {
  // Kurdish (Sorani) writes the same Eastern Arabic digits; not every system
  // has Kurdish number data, so format them as Arabic digits.
  const locale = current === 'en' ? 'en' : 'ar-u-nu-arab';
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** "14 minutes ago" (Kurdish from the dictionary: not every system has it). */
export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  const [count, unit, key]: [number, Intl.RelativeTimeFormatUnit, Key] =
    minutes < 60 ? [minutes, 'minute', 'time.minutes'] : minutes < 1440 ? [Math.round(minutes / 60), 'hour', 'time.hours'] : [Math.round(minutes / 1440), 'day', 'time.days'];
  if (minutes < 1) return t('time.now');
  if (current === 'ku') return t(key, { count });
  try {
    return new Intl.RelativeTimeFormat(current === 'ar' ? 'ar-u-nu-arab' : 'en', { numeric: 'auto' }).format(-count, unit);
  } catch {
    return t(key, { count });
  }
}

export function hasKey(key: string): key is Key {
  return key in en;
}
