// Ten swatches, fixed. §2.1: a free colour picker lets two members end up
// visually indistinguishable on a tablet across the room, which defeats the
// point of colour-coding the calendar. These are spaced in hue and hold up
// against both light and dim/night backgrounds.
export const MEMBER_PALETTE = [
  { name: 'Coral', value: '#ef4444' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Lime', value: '#65a30d' },
  { name: 'Emerald', value: '#059669' },
  { name: 'Teal', value: '#0d9488' },
  { name: 'Sky', value: '#0284c7' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Violet', value: '#7c3aed' },
  { name: 'Fuchsia', value: '#c026d3' },
  { name: 'Rose', value: '#e11d48' },
] as const;

export const HOUSEHOLD_COLOR = '#64748b'; // events with member_id = NULL

export function isPaletteColor(hex: string) {
  return MEMBER_PALETTE.some((c) => c.value.toLowerCase() === hex.toLowerCase());
}

// The migration constrains family_members.color to ^#[0-9a-f]{6}$, so anything
// reaching the DB is already shaped; this is the UI-side guard.
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
