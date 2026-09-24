/**
 * @module ai/h2/services/named-target
 *
 * Whether a company holds what a resource needs *besides* the right site.
 *
 * "Aragorn II only. Only playable in Minas Tirith" — Return of the King
 * (tw-316) declares both halves as `play-target` effects: a `site` it must be
 * played at and a `character` whose filter names Aragorn II. The site half is
 * what `resourcePlayableAt` reads, so the AI knew *where* such a card plays
 * and not *who* plays it, and valued sending any company to Minas Tirith for
 * the card's three points. In recorded game mucofe0c-a8xz9z it would have
 * entered Minas Tirith with Bergil alone, turn after turn, for Return of the
 * King (Aragorn was in the other company) and for The White Tree ("Sage only",
 * and only by discarding a Sapling of the White Tree nobody held).
 *
 * Two requirements are read, both the engine's own:
 *
 * - a `play-target: character` filter, matched with the engine's
 *   `matchesCondition` against the character fields a view can supply —
 *   `target.name`, `target.race`, `target.skills`, `target.keywords`. The
 *   engine builds its context from the game state and adds company facts,
 *   status and more; a filter that reads any of those is not decidable here
 *   and restricts nothing, exactly as before.
 * - a `discard-named-card` play-condition: the named card must be among the
 *   company's items, its cards in play, or the marshalling-point pile, per the
 *   condition's `sources` (mirrors `collectDiscardCandidates`).
 */

import { matchesCondition } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, CompanyId, PlayerView } from '@meccg/shared';

/** The effect fields read here. */
interface Requirement {
  readonly type?: string;
  readonly target?: string;
  readonly filter?: unknown;
  readonly requires?: string;
  readonly cardName?: string;
  readonly sources?: readonly string[];
}

/** The character fields a view can supply to a `play-target` filter. */
const READABLE_KEYS = new Set(['target.name', 'target.race', 'target.skills', 'target.keywords']);

/** Whether every field a condition reads is one this can supply. */
function decidable(condition: unknown): boolean {
  if (!condition || typeof condition !== 'object') return true;
  if (Array.isArray(condition)) return condition.every(decidable);
  return Object.entries(condition as Record<string, unknown>).every(([key, value]) =>
    key.startsWith('$') ? decidable(value) : READABLE_KEYS.has(key));
}

/** The printed name of a definition. */
function nameOf(cardPool: Readonly<Record<string, CardDefinition>>, definitionId: string): string | undefined {
  return (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name;
}

/** Whether a named card sits in one of a condition's discard sources. */
function namedCardAvailable(
  requirement: Requirement,
  characterIds: readonly CardInstanceId[],
  companyId: CompanyId | null,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  const wanted = requirement.cardName;
  if (!wanted) return true;
  const named = (definitionId: string): boolean => nameOf(cardPool, definitionId) === wanted;
  for (const source of requirement.sources ?? ['character-items']) {
    if (source === 'character-items') {
      if (characterIds.some(id => view.self.characters[id]?.items.some(item => named(item.definitionId)))) {
        return true;
      }
    } else if (source === 'cards-in-play') {
      if (view.self.cardsInPlay.some(card =>
        (companyId === null || card.companyId === companyId) && named(card.definitionId))) return true;
    } else if (view.self.killPile.some(card => named(card.definitionId))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a company made of `characterIds` meets what a resource needs beyond
 * its site. `companyId` is null when asking about every character in play at
 * once, for a goal not yet assigned to a company.
 *
 * True for a card with no such requirement, and for one whose requirement
 * reads something a view cannot supply.
 */
export function companyMayPlay(
  def: CardDefinition | undefined,
  characterIds: readonly CardInstanceId[],
  companyId: CompanyId | null,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  const effects = (def as unknown as { effects?: readonly Requirement[] } | undefined)?.effects ?? [];
  for (const effect of effects) {
    if (effect.type === 'play-target' && effect.target === 'character'
      && effect.filter !== undefined && decidable(effect.filter)) {
      const anyone = characterIds.some(id => {
        const character = view.self.characters[id];
        const printed = cardPool[character.definitionId] as unknown as {
          name?: string; race?: string; skills?: readonly string[]; keywords?: readonly string[];
        } | undefined;
        if (!printed) return false;
        return matchesCondition(effect.filter as never, {
          target: {
            name: printed.name,
            race: printed.race,
            skills: printed.skills ?? [],
            keywords: printed.keywords ?? [],
          },
        });
      });
      if (!anyone) return false;
    }
    if (effect.type === 'play-condition' && effect.requires === 'discard-named-card'
      && !namedCardAvailable(effect, characterIds, companyId, view, cardPool)) {
      return false;
    }
  }
  return true;
}
