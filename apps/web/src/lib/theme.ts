import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'ims-theme';
const listeners = new Set<() => void>();

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage may be unavailable (private mode); fall through to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let theme: Theme = readInitial();
document.documentElement.classList.toggle('dark', theme === 'dark');

export function setTheme(next: Theme) {
  theme = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore: the theme just won't persist.
  }
  listeners.forEach((listener) => listener());
}

/** Shared light/dark theme for the whole app, including the login page. */
export function useTheme() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => theme,
  );
  return { theme: current, toggle: () => setTheme(current === 'dark' ? 'light' : 'dark') };
}
