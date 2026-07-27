/**
 * @module ai/h2/services/budget
 *
 * The `budget` service — the hard constraints every acquisition module
 * competes for.
 *
 * Plan §3.1 lists them: free general influence, per-character free direct
 * influence, mind costs, and the taps available this turn. They are
 * constraints rather than preferences, which is what makes them a service
 * instead of a module: there is one true answer per position, every consumer
 * needs the same one, and computing it privately is how two modules end up
 * disagreeing about what is even possible.
 *
 * Everything here is read from the projected view. Nothing is estimated, and
 * nothing is tunable — a service that guessed would be a module in disguise.
 *
 * Two of these are the reason the module set is ordered the way it is.
 * `factions` needs a character with enough **free direct influence** standing
 * at the right site (`reducer-site.ts` checks exactly that, and requires the
 * character be untapped); `characters` needs the **mind** a roster costs
 * against a 20-point pool. Both read those numbers from here.
 */

import { GENERAL_INFLUENCE } from '@meccg/shared';
import { CardStatus, isCharacterCard } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, CompanyId, PlayerView } from '@meccg/shared';

/** What one character costs and can supply. */
export interface CharacterBudget {
  /** The character. */
  readonly instanceId: CardInstanceId;
  /** Its printed name, for explanations. */
  readonly name: string;
  /** Mind cost against the general-influence pool; 0 for an avatar. */
  readonly mind: number;
  /** Total direct influence printed and granted. */
  readonly directInfluence: number;
  /**
   * Direct influence not already committed to followers — the number an
   * influence attempt is actually made with (CoE 4.x).
   */
  readonly freeDirectInfluence: number;
  /** Whether it could tap for something this turn. */
  readonly untapped: boolean;
}

/** The constraints the acting player is working inside. */
export interface Budget {
  /** The player's effective general-influence pool (20, or a revealed avatar's). */
  readonly generalInfluence: number;
  /** How much of it is committed. */
  readonly generalInfluenceUsed: number;
  /** What remains — the mind a new character must fit inside. */
  readonly freeGeneralInfluence: number;
  /** Per-character costs and influence, by instance ID. */
  readonly characters: Readonly<Record<string, CharacterBudget>>;
  /** Characters that could still tap this turn, company by company. */
  untappedIn(companyId: CompanyId): readonly CharacterBudget[];
  /** The largest free direct influence available in a company, and whose it is. */
  bestInfluencerIn(companyId: CompanyId): CharacterBudget | null;
  /** Total taps available across every company. */
  readonly tapsAvailable: number;
}

/** A card's printed name, falling back to the instance ID. */
function nameOf(
  cardPool: Readonly<Record<string, CardDefinition>>,
  definitionId: string,
  instanceId: CardInstanceId,
): string {
  const name = (cardPool[definitionId] as unknown as { name?: string } | undefined)?.name;
  return name ?? (instanceId as string);
}

/** Mind cost of a character definition; avatars print none and cost nothing. */
function mindOf(def: CardDefinition | undefined): number {
  if (!def || !isCharacterCard(def)) return 0;
  return def.mind ?? 0;
}

/**
 * Compute the budget from a player view.
 *
 * Free direct influence subtracts the mind of every character the holder
 * controls, because that influence is already spent holding them — the same
 * subtraction the engine makes. A character with 3 printed DI holding a
 * mind-2 follower brings 1 to an influence attempt, not 3, and an acquisition
 * module that read the printed number would chase factions it cannot reach.
 */
export function computeBudget(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): Budget {
  const characters: Record<string, CharacterBudget> = {};

  for (const character of Object.values(view.self.characters)) {
    const committed = character.followers.reduce((sum, followerId) => {
      const follower = view.self.characters[followerId];
      return sum + (follower ? mindOf(cardPool[follower.definitionId]) : 0);
    }, 0);
    characters[character.instanceId as string] = {
      instanceId: character.instanceId,
      name: nameOf(cardPool, character.definitionId, character.instanceId),
      mind: mindOf(cardPool[character.definitionId]),
      directInfluence: character.effectiveStats.directInfluence,
      freeDirectInfluence: character.effectiveStats.directInfluence - committed,
      untapped: character.status === CardStatus.Untapped,
    };
  }

  const generalInfluence = view.self.generalInfluence ?? GENERAL_INFLUENCE;
  const used = view.self.generalInfluenceUsed;

  const inCompany = (companyId: CompanyId): CharacterBudget[] => {
    const company = view.self.companies.find(c => c.id === companyId);
    if (!company) return [];
    return company.characters
      .map(id => characters[id as string])
      .filter((c): c is CharacterBudget => c !== undefined);
  };

  return {
    generalInfluence,
    generalInfluenceUsed: used,
    freeGeneralInfluence: generalInfluence - used,
    characters,
    tapsAvailable: Object.values(characters).filter(c => c.untapped).length,

    untappedIn(companyId: CompanyId): readonly CharacterBudget[] {
      return inCompany(companyId).filter(c => c.untapped);
    },

    bestInfluencerIn(companyId: CompanyId): CharacterBudget | null {
      // Only an untapped character may attempt an influence check
      // (`reducer-site.ts` validates it), so a tapped character with high
      // direct influence is worth nothing to `factions` this turn.
      const candidates = inCompany(companyId).filter(c => c.untapped);
      if (candidates.length === 0) return null;
      return candidates.reduce((best, c) => (c.freeDirectInfluence > best.freeDirectInfluence ? c : best));
    },
  };
}
