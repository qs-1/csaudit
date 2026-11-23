/**
 * Course colours. One palette drives the timetable blocks and the Overview figures,
 * written as --c0..--c7 (fill) and --c0-on..--c7-on (text on that fill), separately
 * for light and dark so the same palette stays legible on both.
 *
 * Palettes come from coolors.co. Five-colour palettes get three more slots mixed
 * from neighbours so eight courses still read as one family.
 */

export interface Palette { id: string; name: string; hex: string[] }

export const PALETTES: Palette[] = [
  { id: 'garden', name: 'Garden', hex: ['365B45', 'E3B83F', 'D47C70', 'E16B38', '6E9B98'] },
  { id: 'lagoon', name: 'Lagoon', hex: ['3C6E71', '7FC29B', 'B5EF8A', '1F2041', 'D7F171'] },
  { id: 'clay', name: 'Clay', hex: ['A03C2D', '3C5A33', 'D7BBA8', '68A691', '694F5D'] },
  { id: 'apricot', name: 'Apricot', hex: ['E17F5A', 'EFC35A', '99BBA3', '6E9B98', 'F7C8AA'] },
  { id: 'harbour', name: 'Harbour', hex: ['17495A', 'B77457', '6F765C', 'D9BC9A', '102730'] },
  { id: 'meadow', name: 'Meadow', hex: ['4B7B90', 'A6C366', 'CC4760', '8E7DBE', '140702'] },
  { id: 'wine', name: 'Wine', hex: ['A40E4C', '2C2C54', 'ACC3A6', 'F5D6BA', '980101'] },
  { id: 'sunset', name: 'Sunset', hex: ['FFBC42', 'FF8484', '231651', '69747C', 'D6FFF6'] },
  { id: 'punch', name: 'Punch', hex: ['F45B69', '2A2A72', '6DD6DA', 'FDF5BF', '22181C'] },
  { id: 'lilac', name: 'Lilac', hex: ['957FEF', 'EFC35A', '99BBA3', 'DEC0F1', 'B79CED'] },
  { id: 'signal', name: 'Signal', hex: ['C44536', '93A8AC', 'FFDC5E', '1E2D2F', '197278'] },
  { id: 'dusk', name: 'Dusk', hex: ['1C6467', 'AE7D91', '49878F', '4D2E36', 'E5E1DC'] },
];

export const DEFAULT_PALETTE = 'sunset';
const KEY = 'palette';

type RGB = [number, number, number];

const parse = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t = 0.5): RGB => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as RGB;

function toHsl([r, g, b]: RGB): RGB {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: RGB): RGB {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as RGB;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}

/** Keep a colour's hue but pull its lightness into a band that shows on the surface. */
const clampL = (c: RGB, lo: number, hi: number): RGB => {
  const [h, s, l] = toHsl(c);
  return fromHsl([h, s, Math.min(hi, Math.max(lo, l))]);
};

const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Dark ink or white, whichever reads better on the fill. */
const on = (c: RGB): RGB => (lum(c) > 0.32 ? [24, 24, 22] : [255, 255, 255]);

/** The eight slots: the palette's own colours, then mixes of neighbours. */
function slots(p: Palette): RGB[] {
  const base = p.hex.map(parse);
  const out = [...base];
  for (let i = 0; out.length < 8; i++) out.push(mix(base[i % base.length]!, base[(i + 1) % base.length]!));
  return out.slice(0, 8);
}

export function paletteColors(p: Palette, dark: boolean): RGB[] {
  return slots(p).map((c) => (dark ? clampL(c, 0.5, 0.78) : clampL(c, 0.22, 0.72)));
}

const triplet = (c: RGB) => c.join(' ');

function css(p: Palette) {
  const block = (dark: boolean) => {
    const cs = paletteColors(p, dark);
    const vars = cs.map((c, i) => `--c${i}: ${triplet(c)}; --c${i}-on: ${triplet(on(c))};`);
    // Progress everywhere (gauge, rings, bars, checks): done in the first colour, in progress in the second.
    vars.push(`--done: ${triplet(cs[0]!)}; --done-on: ${triplet(on(cs[0]!))}; --doing: ${triplet(cs[1]!)};`);
    // Each hue moved only as far as it takes to reach 3:1 against the card, so it reads as a line or small text
    // and still looks like its fill (darkening a pink all the way turns it into alarm red).
    const ink = (c: RGB) => {
      const [h, s, l0] = toHsl(c);
      const card = dark ? lum([26, 26, 28]) : 1;
      const ratio = (x: RGB) => { const a = lum(x) + 0.05, b = card + 0.05; return Math.max(a, b) / Math.min(a, b); };
      let l = dark ? Math.max(l0, 0.5) : Math.min(l0, 0.72);
      let out = fromHsl([h, s, l]);
      while (ratio(out) < 3 && l > 0.15 && l < 0.9) { l += dark ? 0.01 : -0.01; out = fromHsl([h, s, l]); }
      return triplet(out);
    };
    vars.push(`--done-ink: ${ink(slots(p)[0]!)}; --doing-ink: ${ink(slots(p)[1]!)};`);
    return vars.join(' ');
  };
  return `:root { ${block(false)} } .dark { ${block(true)} }`;
}

export const findPalette = (id: string | null) => PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;

export function storedPalette(): Palette {
  try { return findPalette(localStorage.getItem(KEY)); } catch { return findPalette(null); }
}

export function applyPalette(p: Palette) {
  let el = document.getElementById('palette') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'palette';
    document.head.appendChild(el);
  }
  el.textContent = css(p);
  try { localStorage.setItem(KEY, p.id); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('palette', { detail: p.id }));
}

/** Current palette colours as hex, for drawing outside CSS (the timetable image). */
export function currentHex(dark: boolean): { fill: string[]; ink: string[] } {
  const cs = paletteColors(storedPalette(), dark);
  const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return { fill: cs.map(hex), ink: cs.map((c) => hex(on(c))) };
}
