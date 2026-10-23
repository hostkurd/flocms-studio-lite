// A small helper to build DOM nodes without a framework:
//   h('button', { class: 'btn', onclick: save }, t('common.save'))

export type Child = Node | string | number | null | undefined | false | Child[];

type Handler = (event: Event) => void;
export type Attrs = {
  [name: string]: string | number | boolean | Handler | null | undefined;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value as Handler);
    } else if (name === 'value' || name === 'checked' || name === 'selected' || name === 'disabled') {
      (element as unknown as Record<string, unknown>)[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Left-to-right text (a path, a version, a command) inside any language. */
export function ltr(text: string, className = ''): HTMLElement {
  return h('bdi', { class: ('ltr ' + className).trim(), dir: 'ltr' }, text);
}

export function clear(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/**
 * Translated text with `code` parts (marked with backticks in the
 * dictionaries) as left-to-right code, so `.env` or `composer install`
 * read correctly inside Arabic and Kurdish sentences.
 */
export function rich(text: string): Node[] {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 === 1 ? ltr(part, 'code') : document.createTextNode(part)));
}

/** The same text without the backticks, for plain-text places (toasts, titles). */
export function plain(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1');
}
