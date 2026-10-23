// A modal built on <dialog> (no browser alert/confirm, which block the app).

import { t } from '../i18n/index.ts';
import { h, type Child } from './dom.ts';

export interface Dialog {
  el: HTMLDialogElement;
  body: HTMLElement;
  foot: HTMLElement;
  close(): void;
}

export function openDialog(title: string, ...content: Child[]): Dialog {
  const body = h('div', { class: 'dialog-body' }, content);
  const foot = h('div', { class: 'dialog-foot' });
  const el = h('dialog', { class: 'dialog', 'aria-label': title }, h('h2', null, title), body, foot);
  document.body.append(el);
  el.addEventListener('close', () => el.remove());
  el.showModal();
  return { el, body, foot, close: () => el.close() };
}

/**
 * Asks before something that changes data. With `typed`, the person must type
 * that word (the database name) to go ahead.
 */
export function confirmDialog(options: { title: string; text: Child; action: string; danger?: boolean; typed?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const input = options.typed ? h('input', { class: 'input mono', dir: 'ltr', autocomplete: 'off', 'aria-label': options.typed }) : null;
    const dialog = openDialog(options.title, h('div', null, options.text), input);
    const go = h('button', { type: 'button', class: 'btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary'), disabled: !!options.typed }, options.action);
    const answer = (yes: boolean) => {
      if (answered) return;
      answered = true;
      dialog.close();
      resolve(yes);
    };
    input?.addEventListener('input', () => (go.disabled = input.value.trim() !== options.typed));
    go.addEventListener('click', () => answer(true));
    dialog.foot.append(h('button', { type: 'button', class: 'btn', onclick: () => answer(false) }, t('common.cancel')), go);
    dialog.el.addEventListener('close', () => answer(false));
    (input ?? go).focus();
  });
}
