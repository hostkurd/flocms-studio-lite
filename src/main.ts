import './styles/tokens.css';
import './styles/app.css';

import { isTauri } from './api.ts';
import { mount } from './app.ts';
import { boot } from './state.ts';

async function start(): Promise<void> {
  // `npm run dev` in a plain browser: sample projects instead of the Rust side
  if (import.meta.env.DEV && !isTauri()) {
    const { installMock } = await import('./dev/mock.ts');
    installMock();
  }
  mount(document.getElementById('app')!);
  await boot();
}

void start();
