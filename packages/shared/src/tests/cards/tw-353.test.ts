/**
 * @module tw-353.test
 *
 * Card test: Treebeard (tw-353)
 * Type: hero-resource-ally
 * Effects: 1 (on-event company-arrives-at-site → discard-self when site region
 *             is NOT in Fangorn, Rohan, Gap of Isen, Wold & Foothills,
 *             Enedhwaith, Old Pûkel-land, Brown Lands, Anduin Vales,
 *             or Redhorn Gate)
 *
 * "Unique. Playable at Wellinghall. May not be attacked by automatic-attacks
 *  or hazards keyed to his site. Discard Treebeard if his company moves to a
 *  site that is not in: Fangorn, Rohan, Gap of Isen, Wold & Foothills,
 *  Enedhwaith, Old Pûkel-land, Brown Lands, Anduin Vales, or Redhorn Gate."
 *
 * Engine Support:
 * | # | Feature                                     | Status          | Notes                                         |
 * |---|---------------------------------------------|-----------------|-----------------------------------------------|
 * | 1 | Discard on move to disallowed region         | IMPLEMENTED     | on-event discard-self in fireAllyArrivalEffects |
 * | 2 | Stays when moving to allowed region          | IMPLEMENTED     | when condition filters by site.region          |
 * | 3 | Immunity to automatic-attacks/site hazards   | NOT IMPLEMENTED | auto-attacks not in engine yet                 |
 *
 * Playable: PARTIALLY (auto-attack immunity is a no-op until auto-attacks are implemented)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  attachAllyToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  TREEBEARD,
  LORIEN, MINAS_TIRITH, MOUNT_DOOM, EDORAS, WELLINGHALL, MORIA,
  makeMHState, dispatch,
} from '../test-helpers.js';
// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Treebeard (tw-353)', () => {
  beforeEach(() => resetMint());


  test('Treebeard is discarded when company moves to a site outside allowed regions', () => {
    // Minas Tirith is in Anórien — not in Treebeard's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withTreebeard = attachAllyToChar(base, 0, ARAGORN, TREEBEARD);

    const treebeardInstId = withTreebeard.players[0].characters[
      Object.keys(withTreebeard.players[0].characters)[0]
    ].allies[0].instanceId;

    // Set destination to Minas Tirith (region Anórien — disallowed)
    const minasTirithCard = withTreebeard.players[0].siteDeck[0];
    const withDest = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          companies: [{
            ...withTreebeard.players[0].companies[0],
            destinationSite: { instanceId: minasTirithCard.instanceId, definitionId: minasTirithCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    // Both players pass → endCompanyMH → fireCompanyArrivesAtSite
    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Treebeard should be in discard pile
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === treebeardInstId,
    );
    expect(inDiscard).toBe(true);

    // Treebeard should no longer be attached to Aragorn
    const charId = Object.keys(afterHazardPass.players[0].characters)[0];
    const char = afterHazardPass.players[0].characters[charId];
    const allyStillAttached = char.allies.some(a => a.instanceId === treebeardInstId);
    expect(allyStillAttached).toBe(false);
  });

  test('Treebeard stays when company moves to a site in an allowed region', () => {
    // Edoras is in Rohan — in Treebeard's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withTreebeard = attachAllyToChar(base, 0, ARAGORN, TREEBEARD);

    const treebeardInstId = withTreebeard.players[0].characters[
      Object.keys(withTreebeard.players[0].characters)[0]
    ].allies[0].instanceId;

    // Set destination to Edoras (region Rohan — allowed)
    const edorasCard = withTreebeard.players[0].siteDeck[0];
    const withDest = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          companies: [{
            ...withTreebeard.players[0].companies[0],
            destinationSite: { instanceId: edorasCard.instanceId, definitionId: edorasCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    // Both players pass → endCompanyMH → fireCompanyArrivesAtSite
    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Treebeard should NOT be in discard pile
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === treebeardInstId,
    );
    expect(inDiscard).toBe(false);

    // Treebeard should still be attached to Aragorn
    const charId = Object.keys(afterHazardPass.players[0].characters)[0];
    const char = afterHazardPass.players[0].characters[charId];
    const allyStillAttached = char.allies.some(a => a.instanceId === treebeardInstId);
    expect(allyStillAttached).toBe(true);
  });

  test('Treebeard stays when company moves to Moria (Redhorn Gate — allowed)', () => {
    // Moria is in Redhorn Gate — in Treebeard's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withTreebeard = attachAllyToChar(base, 0, ARAGORN, TREEBEARD);

    const treebeardInstId = withTreebeard.players[0].characters[
      Object.keys(withTreebeard.players[0].characters)[0]
    ].allies[0].instanceId;

    // Set destination to Moria (region Redhorn Gate — allowed)
    const moriaCard = withTreebeard.players[0].siteDeck[0];
    const withDest = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          companies: [{
            ...withTreebeard.players[0].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Treebeard should stay
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === treebeardInstId,
    );
    expect(inDiscard).toBe(false);

    const charId = Object.keys(afterHazardPass.players[0].characters)[0];
    const char = afterHazardPass.players[0].characters[charId];
    expect(char.allies.some(a => a.instanceId === treebeardInstId)).toBe(true);
  });

  test('Treebeard is discarded when company moves to Mount Doom (Gorgoroth — disallowed)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MOUNT_DOOM] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withTreebeard = attachAllyToChar(base, 0, ARAGORN, TREEBEARD);

    const treebeardInstId = withTreebeard.players[0].characters[
      Object.keys(withTreebeard.players[0].characters)[0]
    ].allies[0].instanceId;

    const mountDoomCard = withTreebeard.players[0].siteDeck[0];
    const withDest = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          companies: [{
            ...withTreebeard.players[0].companies[0],
            destinationSite: { instanceId: mountDoomCard.instanceId, definitionId: mountDoomCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Treebeard should be discarded
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === treebeardInstId,
    );
    expect(inDiscard).toBe(true);
  });
});
