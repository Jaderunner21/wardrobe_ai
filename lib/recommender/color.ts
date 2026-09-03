/**
 * Colour harmony — module 08 §3. Pure.
 *
 * The neutral branch fires first and returns a high, flat score. That is correct
 * behaviour, not a shortcut: navy trousers genuinely do go with almost everything, and
 * most of most wardrobes is neutral. It is also why good outfits score 0.70–0.85 rather
 * than near 1.0 — do not retune the weights to chase a bigger number (module 16 §7.5).
 */

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function hexToHsl(hex: string): Hsl {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return { h: 0, s: 0, l: 0.5 };

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);

  return { h: (h + 360) % 360, s, l };
}

/** Black, white, grey, beige, cream — anything without a hue to clash with. */
export const isNeutral = ({ s, l }: Hsl): boolean => s < 0.15 || l < 0.15 || l > 0.85;

export function colorHarmony(hexA: string, hexB: string): number {
  const A = hexToHsl(hexA);
  const B = hexToHsl(hexB);

  if (isNeutral(A) || isNeutral(B)) return 0.85; // neutrals pair with anything

  const raw = Math.abs(A.h - B.h);
  const d = Math.min(raw, 360 - raw);

  if (d >= 150 && d <= 210) return 0.9; // complementary
  if (d < 40) return 0.8; // analogous
  if (d >= 100 && d < 140) return 0.7; // triadic-ish
  if (A.s > 0.6 && B.s > 0.6 && d >= 40 && d < 100) return 0.15; // two loud clashing hues
  return 0.35;
}
