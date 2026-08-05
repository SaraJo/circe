import type { Palette } from './types';

export interface Character {
  name: string;
  tagline: string;
  palette: Palette;
  /** Pre-filled Hermes profile id — lowercase, valid per validateProfileId. */
  suggestedId: string;
}

export interface Cast {
  id: string;
  label: string;
  characters: Character[];
}

const c = (name: string, tagline: string, accent: string, background: string): Character => ({
  name,
  tagline,
  palette: { accent, background },
  suggestedId: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
});

/**
 * §4.6 — Circe ships no character images. A cast entry is a name, a tagline,
 * and two colours. Nothing here may ever reference an image file or a URL.
 */
export const CASTS: Cast[] = [
  {
    id: 'startrek',
    label: 'Star Trek: TNG',
    characters: [
      c('Picard', 'the diplomat', '#c8992e', '#1b1710'),
      c('Data', 'the analyst', '#d8c37a', '#191712'),
      c('Troi', 'the counsellor', '#8f6fb5', '#171320'),
      c('Geordi', 'the engineer', '#4f9e88', '#101a18'),
      c('Wesley', 'the prodigy', '#5b8fd0', '#101620'),
      c('Locutus', 'the assimilator', '#7d8a99', '#12161a'),
    ],
  },
  {
    id: 'hitchhikers',
    label: "Hitchhiker's Guide",
    characters: [
      c('Arthur', 'the reluctant', '#8fae6a', '#141810'),
      c('Ford', 'the researcher', '#d07a4a', '#1c1410'),
      c('Zaphod', 'the two-headed', '#d05a8a', '#1e1218'),
      c('Trillian', 'the coordinator', '#6f9fd0', '#101620'),
      c('Marvin', 'the depressed android', '#6b7280', '#141518'),
      c('Slartibartfast', 'the coastline architect', '#9a8fd0', '#16141f'),
      c('Deep Thought', 'the calculator', '#4fa3a3', '#101a1a'),
      c('Vogon', 'the bureaucrat', '#8a8f5a', '#171810'),
    ],
  },
  {
    id: 'greek',
    label: 'Greek mythology',
    characters: [
      c('Athena', 'the strategist', '#c9b273', '#181610'),
      c('Hermes', 'the messenger', '#6fb0c9', '#101a1d'),
      c('Circe', 'the transformer', '#a67fd4', '#171122'),
      c('Prometheus', 'the fire-bringer', '#d06a4a', '#1c1310'),
      c('Hecate', 'the keeper of thresholds', '#7a6fb5', '#14121e'),
    ],
  },
  {
    id: 'neutral',
    label: 'Neutral',
    characters: [
      c('Alpha', 'the first', '#8b7fd4', '#1a1820'),
      c('Beta', 'the second', '#5f9ea0', '#101a1a'),
      c('Gamma', 'the third', '#c08a5a', '#1a1510'),
      c('Delta', 'the fourth', '#7f9fd4', '#111620'),
    ],
  },
  // Custom has no characters — the user types a name and picks colours.
  { id: 'custom', label: 'Custom', characters: [] },
];

/** Fans opt in to fandoms; the wizard does not push a persona on anyone (§6, Screen 4a). */
export const DEFAULT_CAST_ID = 'neutral';

export function findCast(id: string): Cast | undefined {
  return CASTS.find((cast) => cast.id === id);
}

/** The avatar fallback — a colored circle with the character's first letter (§6.3.2). */
export function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '•';
}
