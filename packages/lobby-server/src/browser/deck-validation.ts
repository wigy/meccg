/**
 * @module deck-validation
 *
 * Pure validation functions for deck building rules. No DOM dependencies —
 * these can be called from tests or from any browser module.
 */

import type { FullDeck } from './app-state.js';
import type { CardDefinition } from '@meccg/shared';

/** A single validation issue with severity level. */
export interface ValidationIssue {
  message: string;
  severity: 'error' | 'warning';
}

/** Card-count breakdown for a deck. */
export interface DeckStats {
  characters: number;
  resources: number;
  hazards: number;
  sites: number;
  /** Total of resources + hazards (the play deck). */
  playDeck: number;
}

/** Compute the card-count breakdown for a deck. */
export function computeStats(deck: FullDeck): DeckStats {
  const characters =
    deck.pool.reduce((s, e) => s + e.qty, 0) +
    deck.deck.characters.reduce((s, e) => s + e.qty, 0);
  const resources = deck.deck.resources.reduce((s, e) => s + e.qty, 0);
  const hazards = deck.deck.hazards.reduce((s, e) => s + e.qty, 0);
  const sites = deck.sites.reduce((s, e) => s + e.qty, 0);
  return { characters, resources, hazards, sites, playDeck: resources + hazards };
}

/** Return all validation issues for a deck. An empty array means the deck is valid. */
export function validateDeck(
  deck: FullDeck,
  pool: Readonly<Record<string, CardDefinition>>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stats = computeStats(deck);

  if (stats.playDeck < 25) {
    issues.push({ message: `Play deck too small: ${stats.playDeck}/25 min`, severity: 'error' });
  } else if (stats.playDeck > 50) {
    issues.push({ message: `Play deck too large: ${stats.playDeck}/50 max`, severity: 'error' });
  }

  const all = [
    ...deck.pool,
    ...deck.deck.characters,
    ...deck.deck.resources,
    ...deck.deck.hazards,
  ];
  for (const entry of all) {
    if (!entry.card) continue;
    const def = pool[entry.card] as unknown as { unique?: boolean } | undefined;
    if (!def) continue;
    if (def.unique && entry.qty > 1) {
      issues.push({ message: `Unique "${entry.name}": max 1 copy`, severity: 'error' });
    } else if (!def.unique && entry.qty > 3) {
      issues.push({ message: `"${entry.name}": max 3 copies`, severity: 'error' });
    }
  }

  return issues;
}
