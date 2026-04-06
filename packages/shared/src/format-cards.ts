/**
 * @module format-cards
 *
 * Card name and detail formatting functions. Converts card definitions
 * and in-play card instances into human-readable text strings with
 * embedded STX markers for the web client.
 */

import type { CardDefinition } from './types/cards.js';
import { isCharacterCard, isItemCard } from './types/cards.js';
import type { CharacterInPlay, ItemInPlay, AllyInPlay } from './types/state.js';
import { CardStatus } from './types/common.js';
import type { CardInstanceId, CardDefinitionId } from './types/common.js';
import { formatSignedNumber, resolve } from './format-helpers.js';
import type { CardLookup, InstanceLookup } from './format-helpers.js';

// ---- Card name formatting ----

/**
 * Formats a card name as plain text.
 * If the card definition is not found, returns "[unknown]".
 * Embeds the card definition ID as \x02id\x02name\x02 marker
 * so the web client can parse it into data attributes.
 */
export function formatCardName(
  def: CardDefinition | undefined,
): string {
  if (!def) return 'a card';
  return `\x02${def.id}\x02${def.name}\x02`;
}

/**
 * Resolves an instance ID through the lookup chain and formats
 * the card name in color, followed by the instance ID in braces
 * so the user can reference it in actions. E.g. "Aragorn II {i-3}".
 * Unknown instances render as dim grey.
 */
export function formatInstanceName(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  const name = formatCardName(def);
  return name;
}

/**
 * Formats a list of card instance IDs as a comma-separated string,
 * grouping duplicates with a count prefix (e.g. "3 x Cave-drake").
 */
export function formatGroupedInstances(
  ids: readonly CardInstanceId[],
  defOf: CardLookup,
  instOf: InstanceLookup,
): string {
  const counts = new Map<string, { name: string; count: number }>();
  for (const id of ids) {
    const name = formatInstanceName(id, defOf, instOf);
    const existing = counts.get(name);
    if (existing) {
      existing.count++;
    } else {
      counts.set(name, { name, count: 1 });
    }
  }
  return [...counts.values()]
    .map(({ name, count }) => count > 1 ? `${count} x ${name}` : name)
    .join(', ');
}

/**
 * Formats a list of card definition IDs as a comma-separated string,
 * grouping duplicates with a count prefix (e.g. "3 x a card").
 * Returns '(empty)' for empty lists.
 */
export function formatCardList(
  ids: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  if (ids.length === 0) return '(empty)';

  // Count occurrences of each rendered name
  const counts = new Map<string, { name: string; count: number }>();
  for (const id of ids) {
    const name = formatCardName(cardPool[id as string]);
    const existing = counts.get(name);
    if (existing) {
      existing.count++;
    } else {
      counts.set(name, { name, count: 1 });
    }
  }

  return [...counts.values()]
    .map(({ name, count }) => count > 1 ? `${count} x ${name}` : name)
    .join(', ');
}

/**
 * Formats a card definition ID (not instance) by looking it up
 * directly in the card pool, followed by the definition ID in braces.
 * Used for draft pools where the user needs the ID for draft-pick commands.
 */
export function formatDefName(
  defId: CardDefinitionId,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const def = cardPool[defId as string];
  const name = formatCardName(def);
  return name;
}

// ---- Card detail formatting ----

/**
 * Returns a small Unicode symbol indicating a card's current status.
 * Placed before card names in text displays for at-a-glance state.
 */
export function statusSymbol(status: CardStatus): string {
  switch (status) {
    case CardStatus.Untapped: return '✅';
    case CardStatus.Tapped: return '❌';
    case CardStatus.Inverted: return '❤️‍🩹';
  }
}

/** Format a character in-play as a single line of text with stats. */
export function formatCharacterLine(char: CharacterInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(char.instanceId, instOf, defOf);
  if (!isCharacterCard(def)) {
    return ('a character');
  }
  const c = def;
  const s = char.effectiveStats;
  const skills = c.skills.join('/');
  const label = formatInstanceName(char.instanceId, defOf, instOf);
  const mindLabel = c.mind !== null ? `${c.mind} Mind, ` : '';
  const cpLabel = s.corruptionPoints > 0 ? `, ${s.corruptionPoints} CP` : '';
  return `${statusSymbol(char.status)} ${label} [${s.prowess}/${s.body}] ${skills} (${mindLabel}${s.directInfluence} DI, ${c.marshallingPoints} MP${cpLabel})`;
}

/** Format an item in-play as a single line of text with stat modifiers. */
export function formatItemLine(item: ItemInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(item.instanceId, instOf, defOf);
  if (!isItemCard(def)) {
    return ('an item');
  }
  const label = formatInstanceName(item.instanceId, defOf, instOf);
  const pMod = formatSignedNumber(def.prowessModifier);
  const bMod = formatSignedNumber(def.bodyModifier);
  return `${statusSymbol(item.status)} ${label} [${pMod}/${bMod}] ${def.subtype} (${def.marshallingPoints} MP, ${def.corruptionPoints} CP)`;
}

/** Format an ally in-play as a single line of text with stats. */
export function formatAllyLine(ally: AllyInPlay, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(ally.instanceId, instOf, defOf);
  if (!def || def.cardType !== 'hero-resource-ally') {
    return ('an ally');
  }
  const label = formatInstanceName(ally.instanceId, defOf, instOf);
  return `${statusSymbol(ally.status)} ${label} [${def.prowess}/${def.body}] (${def.marshallingPoints} MP)`;
}

/** Format a corruption/hazard card attached to a character. */
export function formatCorruptionCardLine(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  const def = resolve(instId, instOf, defOf);
  if (!def) return 'a hazard';
  const label = formatInstanceName(instId, defOf, instOf);
  if (def.cardType === 'hazard-corruption') {
    return `${label} (${def.corruptionPoints} CP)`;
  }
  return label;
}

/** Format a site card's name from its instance ID. */
export function formatSiteName(instId: CardInstanceId, defOf: CardLookup, instOf: InstanceLookup): string {
  return formatInstanceName(instId, defOf, instOf);
}
