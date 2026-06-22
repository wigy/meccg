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
  isFactionCard,
} from './types/cards.js';
import { SiteType, Race } from './types/common.js';

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
  | 'sideboard'  // sideboard
  | 'anti-fw-sideboard'; // anti-Fallen-wizard sideboard (MEWH, max 10)

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
 * Cards that a Fallen-wizard player cannot include in any section of their
 * deck (rule 1.18 / CoE rule 1.5.F6).
 */
const FALLEN_WIZARD_BANNED_CARD_IDS = new Set([
  'le-167', // Bade to Rule
  'as-71',  // The Balrog (ally — AS version)
  'ba-3',   // The Balrog (ally — BA version)
  'tw-205', // Cracks of Doom
  'tw-239', // Favor of the Valar
  'tw-247', // Gollum's Fate
  'dm-141', // Hour of Need
  'le-201', // Kill All But Not the Halflings
  'le-203', // The Lidless Eye
  'as-49',  // Glamour of Surpassing Excellence
  'le-204', // Messenger of Mordor
  'le-208', // News Must Get Through
  'le-209', // News of the Shire
  'tw-294', // Old Road
  'as-56',  // The Sun Unveiled
  'as-107', // Use Your Legs
  'dm-164', // The Windlord Found Me
  'td-169', // Wizard Uncloaked
]);

/**
 * Cards that a Balrog player cannot include in any section of their
 * deck (rule 1.23 / CoE rule 1.3.B5).
 */
const BALROG_BANNED_CARD_IDS = new Set([
  'as-77',  // Above the Abyss
  'le-167', // Bade to Rule
  'as-71',  // The Balrog (ally — AS version)
  'ba-3',   // The Balrog (ally — BA version)
  'tw-12',  // Balrog of Moria
  'wh-41',  // The Black Council
  'as-72',  // Black Horse
  'le-170', // Black Rider
  'le-174', // By the Ringwraith's Word
  'as-73',  // Creature of an Older World
  'dm-107', // Durin's Bane
  'le-183', // Fell Rider
  'wh-44',  // The Fiery Blade
  'as-126', // Helm of Fear
  'le-190', // Heralded Lord
  'le-201', // Kill All But NOT the Halflings
  'le-203', // The Lidless Eye
  'le-205', // Morgul-Blade
  'le-209', // News of the Shire
  'wh-46',  // Open to the Summons
  'as-94',  // Orders from Lugburz
  'as-96',  // Padding Feet
  'le-223', // The Ring Leaves its Mark
  // Ringwraith Unleashed cards
  'le-161', 'le-162', 'le-182', 'le-193', 'le-198',
  'le-200', 'le-222', 'le-248', 'le-257',
  'ba-43',  // Sauron
  'le-242', // They Ride Together
  'as-107', // Use Your Legs
  'le-255', // While The Yellow Face Sleeps
]);

/** Faction races permitted in a Balrog deck (rule 1.22). */
const BALROG_ALLOWED_FACTION_RACES = new Set<Race>([
  Race.Orc, Race.Troll, Race.Wolf, Race.Animal, Race.Dragon,
]);

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
  const antiFwSideboard = deck.antiFwSideboard ?? [];

  // Section typing — the location deck holds sites and nothing else.
  // Site cards may not appear in any other section, and no other card
  // type may appear in the sites section.
  for (const entry of sites) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (!def) continue;
    if (!isSiteCard(def)) {
      const defTyped = def as { name: string; cardType: string };
      errors.push({
        section: 'sites',
        message: `location deck: "${defTyped.name}" has cardType "${defTyped.cardType}" — only sites are allowed in the location deck`,
        card: entry.card,
      });
    }
  }
  {
    const nonSiteSections: [readonly { card: CardDefinitionId | null; qty: number }[], DeckSection][] = [
      [characters, 'characters'],
      [hazards, 'hazards'],
      [resources, 'resources'],
      [poolCards, 'pool'],
      [sideboard, 'sideboard'],
      [antiFwSideboard, 'anti-fw-sideboard'],
    ];
    for (const [section, sectionKey] of nonSiteSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const def = cardPool[entry.card];
        if (!def || !isSiteCard(def)) continue;
        errors.push({
          section: sectionKey,
          message: `site "${def.name}" may only appear in the location deck (sites section)`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.04 — unique card limits (across entire deck except haven sites)
  {
    const counts = new Map<string, number>();
    const allSections = [poolCards, characters, hazards, resources, sideboard];
    for (const section of allSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        counts.set(entry.card as string, (counts.get(entry.card as string) ?? 0) + entry.qty);
      }
    }
    for (const [cardId, count] of counts) {
      const def = cardPool[cardId];
      if (!def) continue;
      if (isAvatarCharacter(def)) {
        // Avatars allow up to 3 copies
        if (count > 3) {
          errors.push({
            section: 'characters',
            message: `avatar "${(def as { name: string }).name}" has ${count} copies (max 3)`,
            card: cardId as CardDefinitionId,
          });
        }
      } else if ('unique' in def && def.unique) {
        if (count > 1) {
          errors.push({
            section: isCharacterCard(def) ? 'characters' : 'resources',
            message: `unique card "${(def as { name: string }).name}" has ${count} copies (max 1)`,
            card: cardId as CardDefinitionId,
          });
        }
      } else {
        if (count > 3) {
          errors.push({
            section: isCharacterCard(def) ? 'characters' : 'resources',
            message: `non-unique card "${(def as { name: string }).name}" has ${count} copies (max 3)`,
            card: cardId as CardDefinitionId,
          });
        }
      }
    }
  }

  // Rule 1.05 — total mind of agent cards ≤ 36
  {
    let totalAgentMind = 0;
    const allSections = [poolCards, characters, hazards, resources, sideboard];
    for (const section of allSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const def = cardPool[entry.card];
        if (!isCharacterCard(def)) continue;
        if (!def.keywords?.includes('agent')) continue;
        if (def.mind !== null) totalAgentMind += def.mind * entry.qty;
      }
    }
    if (totalAgentMind > 36) {
      errors.push({
        section: 'general',
        message: `total mind of agent cards is ${totalAgentMind} (max 36)`,
      });
    }
  }

  // Rule 1.14 — fallen-wizard stricter copy limits
  // Applies on top of rule 1.04: non-unique characters and non-Stage resources
  // are limited to 2 copies. Stage resources (alignment === 'fallen-wizard' on
  // the card) retain the standard max of 3.
  if (deck.alignment === 'fallen-wizard') {
    const fw14Counts = new Map<string, number>();
    const allSections = [poolCards, characters, hazards, resources, sideboard];
    for (const section of allSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        fw14Counts.set(entry.card as string, (fw14Counts.get(entry.card as string) ?? 0) + entry.qty);
      }
    }
    for (const [cardId, count] of fw14Counts) {
      const def = cardPool[cardId];
      if (!def) continue;
      if ('unique' in def && def.unique) continue;
      if (isAvatarCharacter(def)) continue;
      // Cast once to access name/cardType without TypeScript narrowing to never
      const defTyped = def as { name: string; cardType: string; alignment?: string };
      if (isCharacterCard(def)) {
        if (count > 2) {
          errors.push({
            section: 'characters',
            message: `fallen-wizard deck: non-unique character "${defTyped.name}" has ${count} copies (max 2, rule 1.14)`,
            card: cardId as CardDefinitionId,
          });
        }
      } else {
        // Stage resources (alignment === 'fallen-wizard') keep the default max of 3
        if (defTyped.alignment === 'fallen-wizard') continue;
        if (HERO_RESOURCE_TYPES.has(defTyped.cardType) || MINION_RESOURCE_TYPES.has(defTyped.cardType)) {
          if (count > 2) {
            errors.push({
              section: 'resources',
              message: `fallen-wizard deck: non-unique resource "${defTyped.name}" has ${count} copies (max 2, rule 1.14)`,
              card: cardId as CardDefinitionId,
            });
          }
        }
      }
    }
  }

  // Rule 1.08 / 1.11 / 1.16 / 1.19 — avatar characters match alignment
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
    if (deck.alignment === 'fallen-wizard' && def.alignment !== 'fallen-wizard') {
      errors.push({
        section: 'characters',
        message: `fallen-wizard deck: avatar "${def.name}" must be a Fallen-wizard avatar (alignment is "${def.alignment}")`,
        card: entry.card,
      });
    }
    if (deck.alignment === 'balrog' && def.alignment !== 'balrog') {
      errors.push({
        section: 'characters',
        message: `balrog deck: avatar "${def.name}" must be a Balrog avatar (alignment is "${def.alignment}")`,
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

  // Rule 1.22 — balrog character additional restrictions
  if (deck.alignment === 'balrog') {
    for (const [section, sectionKey] of [
      [poolCards, 'pool'],
      [characters, 'characters'],
    ] as const) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const def = cardPool[entry.card];
        if (!isCharacterCard(def) || isAvatarCharacter(def)) continue;
        const race = def.race as string;
        if (race !== 'orc' && race !== 'troll') {
          errors.push({
            section: sectionKey,
            message: `balrog deck: character "${def.name}" has race "${race}" — must be orc or troll`,
            card: entry.card,
          });
        }
        if (def.mind !== null && def.mind >= 9 && !(entry.card as string).startsWith('ba-')) {
          errors.push({
            section: sectionKey,
            message: `balrog deck: character "${def.name}" has mind ${def.mind} ≥ 9 and is not Balrog-specific`,
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

  // Rule 1.30 (CoE 1.5) — the play deck must contain a number of hazards
  // equal to the number of resources. Fewer or more hazards than resources
  // makes the deck illegal (e.g. 30 resources requires exactly 30 hazards).
  const hazardTotal = hazards.reduce((sum, e) => sum + e.qty, 0);
  if (hazardTotal !== resourceTotal) {
    errors.push({
      section: 'hazards',
      message: `play deck: ${hazardTotal} hazards must equal ${resourceTotal} resources`,
    });
  }

  let creatureCount = 0;
  for (const entry of hazards) {
    if (entry.card === null) continue;
    const def = cardPool[entry.card];
    if (def?.cardType === 'hazard-creature') {
      creatureCount += entry.qty;
    } else if (deck.alignment === 'balrog' && isCharacterCard(def) && def.keywords?.includes('agent')) {
      // Rule 1.20: Balrog agents in the hazards section count as half a creature each
      creatureCount += entry.qty * 0.5;
    }
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

  // MEWH — anti-Fallen-wizard sideboard: up to 10 preselected cards added to the
  // main sideboard when the opponent is a Fallen-wizard.
  const antiFwTotal = antiFwSideboard.reduce((sum, e) => sum + e.qty, 0);
  if (antiFwTotal > 10) {
    errors.push({
      section: 'anti-fw-sideboard',
      message: `anti-Fallen-wizard sideboard: ${antiFwTotal} cards (max 10)`,
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

  // Rule 1.18 — fallen-wizard banned cards
  if (deck.alignment === 'fallen-wizard') {
    const allSections: [readonly { card: CardDefinitionId | null; qty: number }[], DeckSection][] = [
      [characters, 'characters'],
      [resources, 'resources'],
      [hazards, 'hazards'],
      [poolCards, 'pool'],
      [sideboard, 'sideboard'],
    ];
    for (const [section, sectionKey] of allSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const cardId = entry.card as string;
        if (FALLEN_WIZARD_BANNED_CARD_IDS.has(cardId)) {
          const def = cardPool[cardId];
          const name = def ? (def as { name: string }).name : cardId;
          errors.push({
            section: sectionKey,
            message: `fallen-wizard deck: "${name}" is not allowed (rule 1.18)`,
            card: entry.card,
          });
        }
      }
    }
  }

  // Rule 1.22 — balrog faction race restriction
  if (deck.alignment === 'balrog') {
    for (const entry of resources) {
      if (entry.card === null) continue;
      const def = cardPool[entry.card];
      if (!isFactionCard(def)) continue;
      if (!BALROG_ALLOWED_FACTION_RACES.has(def.race)) {
        errors.push({
          section: 'resources',
          message: `balrog deck: faction "${def.name}" has race "${def.race}" — must be orc, troll, wolf, animal, or dragon`,
          card: entry.card,
        });
      }
    }
  }

  // Rule 1.23 — balrog banned cards
  if (deck.alignment === 'balrog') {
    const allSections: [readonly { card: CardDefinitionId | null; qty: number }[], DeckSection][] = [
      [characters, 'characters'],
      [resources, 'resources'],
      [hazards, 'hazards'],
      [poolCards, 'pool'],
      [sideboard, 'sideboard'],
    ];
    for (const [section, sectionKey] of allSections) {
      for (const entry of section) {
        if (entry.card === null) continue;
        const cardId = entry.card as string;
        if (BALROG_BANNED_CARD_IDS.has(cardId)) {
          const def = cardPool[cardId];
          const name = def ? (def as { name: string }).name : cardId;
          errors.push({
            section: sectionKey,
            message: `balrog deck: "${name}" is not allowed (rule 1.23)`,
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
