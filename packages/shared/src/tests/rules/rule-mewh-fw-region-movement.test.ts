/**
 * MEWH §7 / CoE rule 1.28 — Fallen-wizard movement across mixed-alignment sites.
 *
 * A Fallen-wizard's location deck mixes hero, minion, and Fallen-wizard sites
 * (CoE rule 1.28), and the player's companies stand on and move between all
 * three kinds. The movement map must therefore index sites of every alignment a
 * Fallen-wizard uses, not just `fallen-wizard` sites.
 *
 * Regression: a Fallen-wizard company standing on a minion site (Ettenmoors,
 * le-373) could not declare movement to any destination, because the movement
 * map only indexed `fallen-wizard` sites — so the company's current site had no
 * region indexed and region movement found nothing. Reported for game
 * mqtbg9mu-u4g9gt at seq 63 ("Cannot play new sites to either company").
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import type { PlanMovementAction } from '../../types/actions-organization.js';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, RIVENDELL, BREE,
} from '../test-helpers.js';

// Sites the Fallen-wizard's location deck mixes (game mqtbg9mu-u4g9gt):
const ETTENMOORS = 'le-373' as CardDefinitionId;       // minion site (ringwraith), Rhudaur
// Zarak Dûm is a minion Ruins & Lairs, the one site type a Fallen-wizard may use
// in either alignment whatever his company's covert/overt status (rule 3.42).
const ZARAK_DUM = 'le-417' as CardDefinitionId;         // minion site (ringwraith), Angmar
const THE_WHITE_TOWERS = 'wh-58' as CardDefinitionId;   // fallen-wizard haven, Arthedain
// BREE (tw-378) is a hero site in Arthedain.

describe('MEWH §7 / rule 1.28 — Fallen-wizard mixed-alignment movement', () => {
  beforeEach(() => resetMint());

  test('FW company on a minion site can declare movement to hero, minion, and FW sites', () => {
    // From Ettenmoors (Rhudaur), every destination is within four regions:
    //   • Bree (hero, Arthedain) — 2 regions
    //   • Zarak Dûm (minion, Angmar) — 2 regions
    //   • The White Towers (FW haven, Arthedain) — 2 regions
    // Before the fix, the FW movement map indexed only fallen-wizard sites, so
    // Ettenmoors had no region indexed and no movement was offered at all.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [BREE, ZARAK_DUM, THE_WHITE_TOWERS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const instOf = (defId: CardDefinitionId) =>
      state.players[0].siteDeck.find(s => s.definitionId === defId)!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    const destinations = new Set(movements.map(a => a.action.destinationSite));
    expect(destinations.has(instOf(BREE))).toBe(true);
    expect(destinations.has(instOf(ZARAK_DUM))).toBe(true);
    expect(destinations.has(instOf(THE_WHITE_TOWERS))).toBe(true);
  });
});
