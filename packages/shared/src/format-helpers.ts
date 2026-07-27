/**
 * @module format-helpers
 *
 * Low-level formatting utilities, CSS color constants, and type aliases
 * shared by all format-* modules. This module contains no game-state
 * awareness — just pure string/number helpers and the canonical card-type
 * color map.
 */

import type { CardDefinition } from './types/cards.js';
import type { CardDefinitionId, CardInstanceId } from './types/common.js';
import { Race } from './types/common.js';

// ---- Formatting helpers ----

/** Format a number with an explicit sign: positive values get a leading '+'. */
export function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/** Strip STX card-ID markers (\x02id\x02name\x02), «MP:…», and «DICE:…» markers from formatted output. */
export function stripCardMarkers(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x02[^\x02]*\x02([^\x02]*)\x02/g, '$1').replace(/«MP:[^»]*»/g, '').replace(/«DICE:[^»]*»/g, '').replace(/«ACTIVE-(?:START|END)»\n?/g, '');
}

// ---- Card type colors (single source of truth) ----

/**
 * CSS color styles for each card type. This is the canonical color mapping
 * used by all rendering paths (web client, text client, deck editor, etc.).
 */
export const CARD_TYPE_CSS: Readonly<Record<string, string>> = {
  'hero-character': 'color:#6090e0;font-weight:bold',
  'hero-resource-item': 'color:#d0a040',
  'hero-resource-faction': 'color:#50b0b0',
  'hero-resource-ally': 'color:#50b0b0',
  'hero-resource-event': 'color:#60c060',
  'hazard-creature': 'color:#e06060',
  'hazard-event': 'color:#e06060',
  'hazard-corruption': 'color:#e06060',
  'hero-site': 'color:#f0e8c0',
  'minion-character': 'color:#c070c0;font-weight:bold',
  // Minion resources mirror the hero split (items gold, factions and
  // allies teal, events green) in darker, murkier shades.
  'minion-resource-item': 'color:#b08030',
  'minion-resource-faction': 'color:#40a0a0',
  'minion-resource-ally': 'color:#40a0a0',
  'minion-resource-event': 'color:#60a060',
  // Slightly greyer than hero sites, so the two pools read apart at a glance.
  'minion-site': 'color:#989898',
  'balrog-site': 'color:#e08030',
  'fallen-wizard-site': 'color:#d0d0d0',
  'region': 'color:#6090e0;opacity:0.6',
};

/** Wizard avatar characters use a darker blue than regular hero characters. */
const WIZARD_CSS = 'color:#3060b0;font-weight:bold';

/** Ringwraith avatar characters use a distinct brown-reddish color. */
const RINGWRAITH_CSS = 'color:#b05030;font-weight:bold';

/** The Balrog avatar uses a deep red, befitting a demon of shadow and flame. */
const BALROG_CSS = 'color:#8b0000;font-weight:bold';

/**
 * Fallen-wizard "stage" resources get their own distinct cyan, so they read
 * apart from ordinary resources (which mirror their underlying card-type color)
 * everywhere they render.
 */
const STAGE_CSS = 'color:#20c8d8';

/**
 * Get the CSS style string for a card definition, considering alignment, card
 * type, and race. Stage-aligned (Fallen-wizard) resources get a distinct cyan;
 * Wizard, Ringwraith, and Balrog avatars get distinct colors from their
 * alignment's regular characters.
 */
export function getCardCss(def: { cardType: string; race?: Race; alignment?: string }): string | undefined {
  if (def.alignment === 'stage') {
    return STAGE_CSS;
  }
  if (def.cardType === 'hero-character' && def.race === Race.Wizard) {
    return WIZARD_CSS;
  }
  if (def.cardType === 'minion-character' && def.race === Race.Ringwraith) {
    return RINGWRAITH_CSS;
  }
  if (def.cardType === 'minion-character' && def.race === Race.Balrog) {
    return BALROG_CSS;
  }
  return CARD_TYPE_CSS[def.cardType];
}

// ---- Type aliases for lookup functions ----

/** Resolves a card definition ID to its full definition. */
export type CardLookup = (defId: CardDefinitionId) => CardDefinition | undefined;

/** Resolves a card instance ID to its definition ID. */
export type InstanceLookup = (instId: CardInstanceId) => CardDefinitionId | undefined;

/** Resolve an instance ID through the lookup chain to a CardDefinition. */
export function resolve(instId: CardInstanceId, instOf: InstanceLookup, defOf: CardLookup): CardDefinition | undefined {
  const defId = instOf(instId);
  return defId ? defOf(defId) : undefined;
}
