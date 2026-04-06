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
  'hero-resource-ally': 'color:#60c060',
  'hero-resource-event': 'color:#60c060',
  'hazard-creature': 'color:#e06060',
  'hazard-event': 'color:#e06060',
  'hazard-corruption': 'color:#e06060',
  'hero-site': 'color:#d0d0d0',
  'minion-character': 'color:#c070c0;font-weight:bold',
  'minion-resource-item': 'color:#a080a0',
  'minion-resource-faction': 'color:#a080a0',
  'minion-resource-ally': 'color:#a080a0',
  'minion-resource-event': 'color:#a080a0',
  'minion-site': 'color:#d0d0d0',
  'balrog-site': 'color:#e08030',
  'fallen-wizard-site': 'color:#d0d0d0',
  'region': 'color:#6090e0;opacity:0.6',
};

/** Wizard avatar characters use a darker blue than regular hero characters. */
const WIZARD_CSS = 'color:#3060b0;font-weight:bold';

/** Ringwraith avatar characters use a distinct brown-reddish color. */
const RINGWRAITH_CSS = 'color:#b05030;font-weight:bold';

/**
 * Get the CSS style string for a card definition, considering both card type
 * and race. Wizard and Ringwraith avatars get distinct colors from their
 * alignment's regular characters.
 */
export function getCardCss(def: { cardType: string; race?: string }): string | undefined {
  if (def.cardType === 'hero-character' && def.race === 'wizard') {
    return WIZARD_CSS;
  }
  if (def.cardType === 'minion-character' && def.race === 'ringwraith') {
    return RINGWRAITH_CSS;
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
