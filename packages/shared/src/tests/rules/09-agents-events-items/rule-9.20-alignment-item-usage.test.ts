/**
 * @module rule-9.20-alignment-item-usage
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.20: Alignment Item Usage Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A minion item borne by a Wizard player's character cannot be used.
 * [MINION] A hero item borne by a Ringwraith player's character cannot be used.
 * [MINION] Ringwraiths may bear items but those items cannot be used.
 * [FALLEN-WIZARD] A Fallen-wizard player's non-Orc, non-Troll characters may bear and use both hero and minion items. A Fallen-wizard player's Orc and Troll characters may bear both hero and minion items, but those characters can only use minion items.
 * [BALROG] A hero item borne by a Balrog player's character cannot be used.
 * [BALROG] Balrogs may bear items but those items cannot be used.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';

// Dagger of Westernesse (tw-206): hero minor item, prowessModifier +1, no DSL effects.
const HERO_ITEM = 'tw-206' as CardDefinitionId;
// Mechanical Bow (wh-53): minion major item, prowessModifier +2, no DSL effects.
const MINION_ITEM = 'wh-53' as CardDefinitionId;
// Layos (le-19): minion character, race "man" (not Orc/Troll/Ringwraith) — isolates
// the player-alignment usage restriction from the character-race-based ones
// (Orc/Troll hero-item ban, Ringwraith-avatar all-item ban).
const LAYOS = 'le-19' as CardDefinitionId;
// Adûnaphel the Ringwraith (le-50): a Ringwraith (Nazgûl) avatar character, printed
// prowess 8 — "Ringwraiths may bear items but those items cannot be used" is about
// this race, not about being owned by a Ringwraith-aligned player.
const RINGWRAITH_AVATAR = 'le-50' as CardDefinitionId;

function prowessWithItem(alignment: Alignment, charDefId: CardDefinitionId, itemDefId: CardDefinitionId) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment, companies: [{ site: RIVENDELL, characters: [{ defId: charDefId, items: [itemDefId] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, charDefId);
  return state.players[RESOURCE_PLAYER].characters[charId].effectiveStats.prowess;
}

describe('Rule 9.20 — Alignment Item Usage Restrictions', () => {
  beforeEach(() => resetMint());

  test('[HERO] a Wizard player\'s character cannot use a minion item it bears', () => {
    // Aragorn (printed prowess 6) bearing the Mechanical Bow (+2) — the
    // bonus does not apply for a Wizard-aligned bearer.
    expect(prowessWithItem(Alignment.Wizard, ARAGORN, MINION_ITEM)).toBe(6);
  });

  test('[MINION] a Ringwraith player\'s character cannot use a hero item it bears', () => {
    // Layos (printed prowess 3) bearing Dagger of Westernesse (+1).
    expect(prowessWithItem(Alignment.Ringwraith, LAYOS, HERO_ITEM)).toBe(3);
  });

  test('[MINION] a Ringwraith player\'s non-avatar character CAN use a matching-alignment (minion) item', () => {
    // Layos bearing the Mechanical Bow (+2) — only hero items are blocked
    // for a Ringwraith-aligned player; the player's own minion items work normally.
    expect(prowessWithItem(Alignment.Ringwraith, LAYOS, MINION_ITEM)).toBe(3 + 2);
  });

  test('[MINION] the Ringwraith (Nazgûl) avatar itself cannot use ANY item, even a minion one', () => {
    // Adûnaphel (printed prowess 8) bearing the Mechanical Bow (+2, minion,
    // matching her own alignment) — still no bonus. This is a race-based ban
    // on the avatar character, distinct from the player-alignment ban above.
    expect(prowessWithItem(Alignment.Ringwraith, RINGWRAITH_AVATAR, MINION_ITEM)).toBe(8);
  });

  test('[FALLEN-WIZARD] a non-Orc/Troll character may use both hero and minion items', () => {
    expect(prowessWithItem(Alignment.FallenWizard, LAYOS, MINION_ITEM)).toBe(3 + 2);
    expect(prowessWithItem(Alignment.FallenWizard, LAYOS, HERO_ITEM)).toBe(3 + 1);
  });

  // Control: a Wizard player's character normally benefits from a hero item.
  test('control: a Wizard player\'s character normally uses a hero item it bears', () => {
    expect(prowessWithItem(Alignment.Wizard, ARAGORN, HERO_ITEM)).toBe(6 + 1);
  });
});
