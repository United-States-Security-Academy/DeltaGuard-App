/**
 * Deltacon brand palette. The same four colours are registered in
 * tailwind.config.js (`ink`, `navy`, `gold`, `white`); use the Tailwind
 * classes in components and these constants only where a raw colour value is
 * needed (navigation theme, icons, placeholders).
 */
export const brand = {
  /** Deepest navy: screen backgrounds. */
  ink: '#050E1D',
  /** Navy: cards, inputs, headers, the tab bar. */
  navy: '#10213A',
  /** Badge gold: primary actions, highlights, active states. */
  gold: '#D6B562',
  /** Text and icons on navy. */
  white: '#FFFFFF',
} as const;

/** Muted white for secondary text and inactive icons. */
export const mutedWhite = 'rgba(255, 255, 255, 0.6)';
