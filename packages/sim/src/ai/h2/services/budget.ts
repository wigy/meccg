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
import { memoizeOnFirst } from '../core/memo.js';
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
  /**
   * The influence position after a hypothetical `move-to-influence`: the
   * character moved under `controlledBy` (`'general'`, or the holder it
   * becomes a follower of), everything else unchanged.
   *
   * Pure — the budget itself is not modified. A follower is held by direct
   * influence equal to his mind, and a general-influence character is charged
   * to the pool, so the move shifts exactly that much between the two: the
   * old holder's free direct influence rises, the new holder's falls, and
   * the general pool moves when either end is `'general'`. Control cost is
   * taken as effective mind; the engine's control-cost overrides are not in
   * the view, recorded rather than guessed.
   */
  afterInfluenceMove(
    characterInstanceId: CardInstanceId,
    controlledBy: 'general' | CardInstanceId,
  ): {
    readonly freeGeneralInfluence: number;
    /** Free direct influence per character, by instance ID. */
    readonly freeDirectInfluence: Readonly<Record<string, number>>;
  };
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
function buildComputeBudget(
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

    afterInfluenceMove(
      characterInstanceId: CardInstanceId,
      controlledBy: 'general' | CardInstanceId,
    ): {
      readonly freeGeneralInfluence: number;
      readonly freeDirectInfluence: Readonly<Record<string, number>>;
    } {
      const moved = characters[characterInstanceId as string];
      const mind = moved?.mind ?? 0;
      // Who holds him now: the character whose follower list names him, or
      // the general pool.
      const holder = Object.values(view.self.characters)
        .find(c => c.followers.includes(characterInstanceId))?.instanceId;
      const from: 'general' | CardInstanceId = holder ?? 'general';

      const freeDirectInfluence: Record<string, number> = {};
      for (const [id, character] of Object.entries(characters)) {
        let free = character.freeDirectInfluence;
        if (id === (from as string)) free += mind;
        if (id === (controlledBy as string)) free -= mind;
        freeDirectInfluence[id] = free;
      }
      const freeGeneral = generalInfluence - used
        + (from === 'general' && controlledBy !== 'general' ? mind : 0)
        - (from !== 'general' && controlledBy === 'general' ? mind : 0);
      return { freeGeneralInfluence: freeGeneral, freeDirectInfluence };
    },
  };
}

/**
 * Build the service, once per position.
 *
 * The registry asks every module about every candidate on a decision and hands
 * them all the same view, so this would otherwise be rebuilt once per
 * candidate for an answer that cannot differ. See `core/memo`.
 */
export const computeBudget = memoizeOnFirst(buildComputeBudget);
