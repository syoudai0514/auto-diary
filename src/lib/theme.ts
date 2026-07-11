'use client';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'voice-diary-theme';

export function loadTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function saveTheme(theme: Theme): void {
  if (typeof localStorage === 'undefined') return;
  if (theme === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
