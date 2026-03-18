import type { CardDefinition } from '../types/cards.js';
import characters from './characters.json';
import items from './items.json';
import creatures from './creatures.json';
import sites from './sites.json';
import regions from './regions.json';

const allCards: readonly CardDefinition[] = [
  ...(characters as unknown as CardDefinition[]),
  ...(items as unknown as CardDefinition[]),
  ...(creatures as unknown as CardDefinition[]),
  ...(sites as unknown as CardDefinition[]),
  ...(regions as unknown as CardDefinition[]),
];

export function loadCardPool(): Readonly<Record<string, CardDefinition>> {
  const pool: Record<string, CardDefinition> = {};
  for (const card of allCards) {
    pool[card.id] = card;
  }
  return pool;
}
