'use client';

/**
 * Which theme is showing, and remembering it.
 *
 * One class on `<html>` and the token block in globals.css does the rest — no
 * component knows the theme exists. Kept here rather than in a context because
 * there is exactly one consumer (the user menu) and a provider would re-render
 * the whole board to change a class name.
 */

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'lanyard.theme';

/**
 * Dark unless something says otherwise — deliberately not
 * `prefers-color-scheme`.
 *
 * This app has been dark since it was built and is read on a show floor. A
 * light OS setting silently repainting someone's board on the next deploy is a
 * change nobody asked for; choosing light is a decision, and it persists.
 */
export const DEFAULT_THEME: Theme = 'dark';

/**
 * Applied in a blocking script before first paint — see the root layout.
 *
 * Inline and stringified because a `useEffect` runs after hydration: the dark
 * page would paint, then flip to light for anyone who chose light. A flash of
 * the wrong theme on every navigation is worse than the tiny script.
 */
export const THEME_BOOT_SCRIPT = `
try {
  var t = localStorage.getItem('${THEME_KEY}');
  if (t === 'light') document.documentElement.classList.remove('dark');
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {}
`.trim();

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked. The class is already set, so this session is fine and
    // only the next load reverts to the default.
  }
}
