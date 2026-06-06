/**
 * @module deck-validation
 *
 * Validates a {@link DeckList} against the CoE deck construction rules.
 * Each error carries a {@link DeckSection} so callers can route it to the
 * correct panel of the deck editor UI, and a human-readable message for
 * display in text logs or tooltips.
 *
 * Used in tests (verifying the engine enforces the rules) and at runtime
 * (lobby server pre-game deck check so both players see the failure list).
 */

import type { DeckList, CardDefinition } from './types/cards.js';
import type { CardDefinitionId } from './types/common.js';
import {
  isCharacterCard,
  isAvatarCharacter,
  isSiteCard,
  isItemCard,
} from './types/cards.js';
import { SiteType } from './types/common.js';

/**
 * Which part of the deck an error belongs to.
 * Maps to a visible panel in the deck editor UI.
 */
export type DeckSection =
  | 'general'    // structural / missing section, or top-level constraint
  | 'characters' // play deck characters section (and pool characters)
  | 'resources'  // play deck resources section
  | 'hazards'    // play deck hazards section
  | 'sites'      // location deck
  | 'pool'       // starting pool (non-character cards)
  | 'sideboard'; // sideboard

/**
 * A single deck validation error.
 * `section` routes the error to the right deck editor panel.
 * `card` identifies the offending card (absent for count/structural errors).
 */
export interface DeckValidationError {
  /** Which part of the deck this error belongs to. */
  readonly section: DeckSection;
  /** Human-readable explanation of the violation. */
  readonly message: string;
  /**
   * The card definition ID that triggered the error, if applicable.
   * Absent for structural/count errors that don't point to a single card.
   */
  readonly card?: CardDefinitionId;
}

/**
 * Minion sites that a Balrog player cannot include because a Balrog-specific
 * version of that site exists and must be used instead (rule 1.29).
 */
const BALROG_RESTRICTED_MINION_SITE_IDS = new Set([
  'le-392', // Moria (minion) → use ba-93
  'le-359', // Carn Dûm (minion) → use ba-93 equivalent
  'le-367', // Dol Guldur (minion) → use ba-93 equivalent
  'le-390', // Minas Morgul (minion) → use ba-93 equivalent
]);

const HERO_RESOURCE_TYPES = new Set([
  'hero-resource-item',
  'hero-resource-faction',
  'hero-resource-ally',
  'hero-resource-event',
]);

const MINION_RESOURCE_TYPES = new Set([
  'minion-resource-item',
  'minion-resource-faction',
  'minion-resource-ally',
  'minion-resource-event',
]);

/**
 * Validate a deck against CoE deck-construction rules.
 *
 * @param deck  The deck to validate.
 * @param cardPool  Card definition lookup keyed by {@link CardDefinitionId}.
 * @returns     Array of structured errors. Empty array means the deck is valid.
 */
export function validateDeck(
  deck: DeckList,
  cardPool: Readonly<Record<string, CardDefinition>>,
): DeckValidationError[] {
  const errors: DeckValidationError[] = [];

  // Rule 1.03 — structural completeness
  if (!Array.isArray(deck.sites)) {
    errors.push({ section: 'general', message: 'missing location deck (sites)' });
  }
  if (!Array.isArray(deck.pool)) {
    errors.push({ section: 'general', message: 'missing pool' });
  }
  if (!Array.isArray(deck.sideboard)) {
    errors.push({ section: 'general', message: 'missing sideboard' });
  }
  if (!deck.deck) {
    errors.push({ section: 'general', message: 'missing play deck' });
  } else {
    if (!Array.isArray(deck.deck.characters)) {
      errors.push({ section: 'characters', message: 'play deck missing characters section' });
    }
    if (!Array.isArray(deck.deck.hazards)) {
      errors.push({ section: 'hazards', message: 'play deck missing hazards section' });
    }
    if (!Array.isArray(deck.deck.resources)) {
      errors.push({ section: 'resources', message: 'play deck missing resources section' });
    }
  }

  if (!deck.deck) return errors;

  const characters = deck.deck.characters ?? [];
  const hazards = deck.deck.hazards ?? [];
  const resources = deck.deck.resources ?? [];
  const sites = deck.sites ?? [];
  const poolCards = deck.pool ?? [];
  const sideboard = deck.sideboard ?? [];

  // Rule 1.08 / 1.11 — avatar characters match alignment
  for (const entry of characters) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (!isCharacterCard(def) || !isAvatarCharacter(def)) continue;
    if (deck.alignment === 'hero' && def.race !== 'wizard') {
      errors.push({
        section: 'characters',
        message: `hero deck: avatar "${def.name}" must be a Wizard (race is "${def.race}")`,
        card: entry.card,
      });
    }
    if (deck.alignment === 'minion' && def.race !== 'ringwraith') {
      errors.push({
        section: 'characters',
        message: `minion deck: avatar "${def.name}" must be a Ringwraith (race is "${def.race}")`,
        card: entry.card,
      });
    }
  }

  // Rule 1.09 / 1.12 — non-avatar characters match alignment
  for (const [section, sectionKey] of [
    [poolCards, 'characters'],
    [characters, 'characters'],
  ] as const) {
    for (const entry of section) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isCharacterCard(def) || isAvatarCharacter(def)) continue;
      if (deck.alignment === 'hero') {
        // Agents count as hazards for hero decks — allowed in hero decks
        if ('keywords' in def && Array.isArray(def.keywords) && def.keywords.includes('agent')) {
          continue;
        }
        if (def.cardType !== 'hero-character') {
          errors.push({
            section: sectionKey,
            message: `hero deck: non-avatar character "${def.name}" has cardType "${def.cardType}" — must be hero-character`,
            card: entry.card,
          });
        }
      }
      if (deck.alignment === 'minion' && def.cardType !== 'minion-character') {
        errors.push({
          section: sectionKey,
          message: `minion deck: character "${def.name}" has cardType "${def.cardType}" — must be minion-character`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.10 — hero resources
  if (deck.alignment === 'hero') {
    for (const entry of resources) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!def) continue;
      const allowed = HERO_RESOURCE_TYPES.has(def.cardType) || def.cardType === 'minion-resource-item';
      if (!allowed) {
        errors.push({
          section: 'resources',
          message: `hero deck: resource "${def.name}" has cardType "${def.cardType}" — must be hero-resource-* or minion-resource-item`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.20 — balrog non-avatar characters must be minion
  if (deck.alignment === 'balrog') {
    for (const [section, sectionKey] of [
      [poolCards, 'pool'],
      [characters, 'characters'],
    ] as const) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const def = cardPool[entry.card];
        if (!isCharacterCard(def) || isAvatarCharacter(def)) continue;
        if (def.cardType !== 'minion-character') {
          errors.push({
            section: sectionKey,
            message: `balrog deck: character "${def.name}" has cardType "${def.cardType}" — must be minion-character`,
            card: entry.card,
          });
        }
      }
    }
  }

  // Rule 1.13 — minion resources
  if (deck.alignment === 'minion') {
    for (const entry of resources) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!def) continue;
      const allowed = MINION_RESOURCE_TYPES.has(def.cardType) || def.cardType === 'hero-resource-item';
      if (!allowed) {
        errors.push({
          section: 'resources',
          message: `minion deck: resource "${def.name}" has cardType "${def.cardType}" — must be minion-resource-* or hero-resource-item`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.21 — balrog resources must be minion
  if (deck.alignment === 'balrog') {
    for (const entry of resources) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!def) continue;
      if (!MINION_RESOURCE_TYPES.has(def.cardType)) {
        errors.push({
          section: 'resources',
          message: `balrog deck: resource "${def.name}" has cardType "${def.cardType}" — must be minion-resource-*`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.24 — non-haven sites appear at most once in location deck
  const nonHavenSeen = new Set<string>();
  for (const entry of sites) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (!isSiteCard(def)) continue;
    if (def.siteType === SiteType.Haven) continue;
    const cardId = entry.card as string;
    if (entry.qty > 1) {
      errors.push({
        section: 'sites',
        message: `location deck: non-haven site "${def.name}" has qty ${entry.qty} — max is 1`,
        card: entry.card,
      });
    } else if (nonHavenSeen.has(cardId)) {
      errors.push({
        section: 'sites',
        message: `location deck: non-haven site "${def.name}" appears more than once`,
        card: entry.card,
      });
    }
    nonHavenSeen.add(cardId);
  }

  // Rule 1.26 — hero location deck uses hero/balrog sites
  if (deck.alignment === 'hero') {
    for (const entry of sites) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isSiteCard(def)) continue;
      if (def.cardType !== 'hero-site' && def.cardType !== 'balrog-site') {
        errors.push({
          section: 'sites',
          message: `hero deck: site "${def.name}" has cardType "${def.cardType}" — must be hero-site or balrog-site`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.27 — minion location deck uses minion/balrog sites
  if (deck.alignment === 'minion') {
    for (const entry of sites) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isSiteCard(def)) continue;
      if (def.cardType !== 'minion-site' && def.cardType !== 'balrog-site') {
        errors.push({
          section: 'sites',
          message: `minion deck: site "${def.name}" has cardType "${def.cardType}" — must be minion-site or balrog-site`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.30 — play deck composition
  const resourceTotal = resources.reduce((sum, e) => sum + e.qty, 0);
  if (resourceTotal < 30) {
    errors.push({
      section: 'resources',
      message: `play deck: only ${resourceTotal} resources (min 30)`,
    });
  }
  if (resourceTotal > 50) {
    errors.push({
      section: 'resources',
      message: `play deck: ${resourceTotal} resources (max 50)`,
    });
  }

  let creatureCount = 0;
  for (const entry of hazards) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (def?.cardType === 'hazard-creature') creatureCount += entry.qty;
  }
  if (creatureCount < 12) {
    errors.push({
      section: 'hazards',
      message: `play deck: only ${creatureCount} creatures in hazards (min 12)`,
    });
  }

  let nonAvatarCharCount = 0;
  for (const entry of characters) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (isCharacterCard(def) && !isAvatarCharacter(def)) nonAvatarCharCount += entry.qty;
  }
  if (nonAvatarCharCount > 10) {
    errors.push({
      section: 'characters',
      message: `play deck: ${nonAvatarCharCount} non-avatar characters (max 10)`,
    });
  }

  // Rule 1.31 — sideboard size
  const sideboardTotal = sideboard.reduce((sum, e) => sum + e.qty, 0);
  if (sideboardTotal > 30) {
    errors.push({
      section: 'sideboard',
      message: `sideboard: ${sideboardTotal} cards (max 30 for Short Game)`,
    });
  }

  // Rule 1.28 — fallen-wizard location deck
  if (deck.alignment === 'fallen-wizard') {
    const fwNonHavenSeen = new Set<string>();
    for (const entry of sites) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isSiteCard(def)) continue;
      if (def.cardType === 'balrog-site') {
        errors.push({
          section: 'sites',
          message: `fallen-wizard deck: site "${def.name}" has cardType "balrog-site" — not allowed`,
          card: entry.card,
        });
        continue;
      }
      // FW sites may appear multiple times; hero and minion sites: 1 copy each
      if (def.cardType !== 'fallen-wizard-site') {
        const cardId = entry.card as string;
        if (entry.qty > 1) {
          errors.push({
            section: 'sites',
            message: `fallen-wizard deck: site "${def.name}" has qty ${entry.qty} — hero/minion sites may appear at most once`,
            card: entry.card,
          });
        } else if (fwNonHavenSeen.has(cardId)) {
          errors.push({
            section: 'sites',
            message: `fallen-wizard deck: site "${def.name}" appears more than once — hero/minion sites allowed at most once`,
            card: entry.card,
          });
        }
        fwNonHavenSeen.add(cardId);
      }
    }
  }

  // Rule 1.29 — balrog location deck
  if (deck.alignment === 'balrog') {
    for (const entry of sites) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isSiteCard(def)) continue;
      if (def.cardType === 'hero-site' || def.cardType === 'fallen-wizard-site') {
        errors.push({
          section: 'sites',
          message: `balrog deck: site "${def.name}" has cardType "${def.cardType}" — not allowed`,
          card: entry.card,
        });
      } else if (def.cardType === 'minion-site') {
        const cardId = entry.card as string;
        if (BALROG_RESTRICTED_MINION_SITE_IDS.has(cardId)) {
          errors.push({
            section: 'sites',
            message: `balrog deck: site "${def.name}" requires the Balrog-specific version`,
            card: entry.card,
          });
        } else if (def.siteType === SiteType.DarkHold) {
          errors.push({
            section: 'sites',
            message: `balrog deck: dark-hold site "${def.name}" requires a Balrog-specific version`,
            card: entry.card,
          });
        }
      }
    }
  }

  // Rule 1.32 — pool limits
  let poolNonAvatarCharCount = 0;
  let poolMinorItemCount = 0;
  for (const entry of poolCards) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (isCharacterCard(def) && !isAvatarCharacter(def)) {
      poolNonAvatarCharCount += entry.qty;
    } else if (isItemCard(def) && def.subtype === 'minor' && !def.unique) {
      poolMinorItemCount += entry.qty;
    }
  }
  if (poolNonAvatarCharCount > 10) {
    errors.push({
      section: 'pool',
      message: `pool: ${poolNonAvatarCharCount} non-avatar characters (max 10)`,
    });
  }
  if (poolMinorItemCount > 2) {
    errors.push({
      section: 'pool',
      message: `pool: ${poolMinorItemCount} non-unique minor items (max 2)`,
    });
  }

  return errors;
}
