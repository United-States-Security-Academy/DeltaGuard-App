// Shared by the root layout (server) and ThemeToggle (client).

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'dg-theme';

/**
 * Runs in <head> before first paint (see app/layout.tsx) and sets
 * <html data-theme>: the saved choice, else the OS setting. Plain ES5 on purpose.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.setAttribute("data-theme",t)}catch(e){d.setAttribute("data-theme","light")}})()`;
