// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import type { LockWindowApiType } from '../types.std.ts';
import { drop } from '../../../util/drop.std.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`lock window: missing #${id}`);
  }
  return element as T;
}

async function start(): Promise<void> {
  const api: LockWindowApiType | undefined = window.WrenLockWindow;
  if (!api) {
    throw new Error('lock window: preload API missing');
  }

  const root = byId<HTMLElement>('root');
  const form = byId<HTMLFormElement>('form');
  const input = byId<HTMLInputElement>('passphrase');
  const button = byId<HTMLButtonElement>('submit');
  const status = byId<HTMLElement>('status');

  const { theme, strings } = await api.getInfo();
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.title = strings.title;
  byId('title').textContent = strings.title;
  byId('prompt').textContent = strings.prompt;
  byId('submit-label').textContent = strings.unlock;
  input.placeholder = strings.placeholder;
  input.setAttribute('aria-label', strings.placeholder);
  root.hidden = false;
  input.focus();

  const setBusy = (busy: boolean) => {
    form.classList.toggle('busy', busy);
    input.disabled = busy;
    button.disabled = busy;
    byId('submit-label').textContent = busy ? strings.checking : strings.unlock;
  };

  const shake = () => {
    form.classList.remove('shake');
    requestAnimationFrame(() => form.classList.add('shake'));
  };

  form.addEventListener('animationend', () => form.classList.remove('shake'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!input.value || button.disabled) {
      return;
    }

    setBusy(true);
    status.textContent = '';
    const passphrase = input.value;
    input.value = '';

    try {
      const result = await api.unlock(passphrase);
      if (result.status === 'unlocked') {
        return;
      }
      if (result.status === 'busy') {
        setBusy(false);
        return;
      }
      status.textContent = result.message;
    } catch {
      status.textContent = '';
    }

    setBusy(false);
    shake();
    input.focus();
  });
}

drop(start());
