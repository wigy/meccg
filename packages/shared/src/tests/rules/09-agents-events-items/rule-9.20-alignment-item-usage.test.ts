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

// Dagger of Westernesse (tw-206): hero item, +1 prowess (unconditional, max 8).
const HERO_ITEM = 'tw-206' as CardDefinitionId;
// Mechanical Bow (wh-53): minion item, "Warrior only: +2 prowess (max 8)". The
// prowess bonus is warrior-gated, so the bearer below is a warrior for the bonus
// to serve as an observable "the item is being used" probe.
const MINION_ITEM = 'wh-53' as CardDefinitionId;
// Dorelas (le-8): minion character, race "man" (not Orc/Troll/Ringwraith), skill
// warrior — isolates the player-alignment usage restriction from the character-
// race-based ones (Orc/Troll hero-item ban, Ringwraith-avatar all-item ban) while
// still qualifying for the Mechanical Bow's warrior-only prowess bonus.
const BEARER = 'le-8' as CardDefinitionId;
const BEARER_PROWESS = 2;
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
    // Dorelas (printed prowess 2) bearing Dagger of Westernesse (+1) — the hero
    // item's bonus does not apply for a Ringwraith-aligned bearer.
    expect(prowessWithItem(Alignment.Ringwraith, BEARER, HERO_ITEM)).toBe(BEARER_PROWESS);
  });

  test('[MINION] a Ringwraith player\'s non-avatar character CAN use a matching-alignment (minion) item', () => {
    // Dorelas (warrior) bearing the Mechanical Bow (+2) — only hero items are blocked
    // for a Ringwraith-aligned player; the player's own minion items work normally.
    expect(prowessWithItem(Alignment.Ringwraith, BEARER, MINION_ITEM)).toBe(BEARER_PROWESS + 2);
  });

  test('[MINION] the Ringwraith (Nazgûl) avatar itself cannot use ANY item, even a minion one', () => {
    // Adûnaphel (printed prowess 8) bearing the Mechanical Bow (+2, minion,
    // matching her own alignment) — still no bonus. This is a race-based ban
    // on the avatar character, distinct from the player-alignment ban above.
    expect(prowessWithItem(Alignment.Ringwraith, RINGWRAITH_AVATAR, MINION_ITEM)).toBe(8);
  });

  test('[FALLEN-WIZARD] a non-Orc/Troll character may use both hero and minion items', () => {
    expect(prowessWithItem(Alignment.FallenWizard, BEARER, MINION_ITEM)).toBe(BEARER_PROWESS + 2);
    expect(prowessWithItem(Alignment.FallenWizard, BEARER, HERO_ITEM)).toBe(BEARER_PROWESS + 1);
  });

  // Control: a Wizard player's character normally benefits from a hero item.
  test('control: a Wizard player\'s character normally uses a hero item it bears', () => {
    expect(prowessWithItem(Alignment.Wizard, ARAGORN, HERO_ITEM)).toBe(6 + 1);
  });
});
