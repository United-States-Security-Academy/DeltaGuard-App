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

/** Tab bar height above the safe area; the SOS button floats just above it. */
export const TAB_BAR_HEIGHT = 68;

/** Muted white for secondary text and inactive icons. */
export const mutedWhite = 'rgba(255, 255, 255, 0.6)';

/** Header background: the same flat ink as the page, so they read as one surface. */
export const headerInk = brand.ink;

/** Lightest gold of the tab bar slab (the colour behind the screen's rounded corners). */
export const slabGold = '#EBCF86';

/**
 * Surface styles. Pages are flat ink, cards flat navy with a hairline border
 * and a soft shadow; gold is kept for actions, highlights and the tab bar.
 * Only the brand colours. These use React Native's CSS-style `boxShadow` /
 * `backgroundImage` (new architecture): pass them in `style`.
 *
 * The page background (`backdrop`) is painted by the navigators (Tabs
 * `sceneStyle`, Stack `contentStyle`); screens stay transparent (`fx.screen`).
 */
export const fx = {
  /** Page background: flat ink, no gradient. */
  backdrop: { backgroundColor: brand.ink },
  /** For a screen's root view: transparent, so the navigator's backdrop shows. */
  screen: { backgroundColor: 'transparent' },
  /** Card / tile: flat navy with a soft shadow. */
  glass: {
    backgroundColor: brand.navy,
    boxShadow: '0px 6px 16px rgba(0,0,0,0.35)',
  },
  /** Card that needs attention now: navy with a faint gold edge. */
  glassGlow: {
    backgroundColor: brand.navy,
    boxShadow: '0px 0px 0px 1px rgba(214,181,98,0.45), 0px 6px 16px rgba(0,0,0,0.35)',
  },
  /** Primary action: solid gold. */
  gold: {
    backgroundColor: brand.gold,
    boxShadow: '0px 4px 12px rgba(214,181,98,0.25)',
  },
  /** Focus ring for inputs. */
  focusGlow: { boxShadow: '0px 0px 0px 2px rgba(214,181,98,0.35)' },
  /** Tab bar: the bright gold bottom slab. */
  tabBar: {
    backgroundColor: brand.gold,
    backgroundImage: [
      'linear-gradient(100deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.22) 45%, rgba(255,255,255,0) 60%)',
      `linear-gradient(180deg, ${slabGold} 0%, #D6B562 45%, #A8873B 100%)`,
    ].join(', '),
  },
} as const;
