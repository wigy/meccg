/**
 * @module tw-328.test
 *
 * Card test: Skinbark (tw-328)
 * Type: hero-resource-ally
 * Effects: 2 (play-flag no-attack-site-keyed; on-event company-arrives-at-site
 *             → discard-self when site region is NOT in Fangorn, Rohan, Gap of
 *             Isen, Wold & Foothills, Anduin Vales, or Redhorn Gate)
 *
 * "Unique. Playable at Wellinghall. May not be attacked by automatic-attacks
 *  or hazards keyed to his site. Discard Skinbark if his company moves to a
 *  site that is not in: Fangorn, Rohan, Gap of Isen, Wold & Foothills, Anduin
 *  Vales, or Redhorn Gate."
 *
 * Skinbark's allowed-region list is a strict subset of Treebeard's (tw-353):
 * it omits Enedhwaith, Old Pûkel-land, and Brown Lands. The tests below cover
 * both the shared regions and a region (Brown Lands) that is allowed for
 * Treebeard but disallowed for Skinbark, to pin down the narrower list.
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                            |
 * |---|---------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Discard on move to disallowed region         | IMPLEMENTED | on-event discard-self in fireAllyArrivalEffects   |
 * | 2 | Stays when moving to allowed region          | IMPLEMENTED | when condition filters by site.region             |
 * | 3 | Immunity to automatic-attacks/site hazards   | IMPLEMENTED | play-flag: no-attack-site-keyed (as on Quickbeam) |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId, AssignStrikeAction } from '../../index.js';
import {
  buildTestState, resetMint, Phase, CardStatus,
  attachAllyToChar,
  findCharInstanceId,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MINAS_TIRITH, MOUNT_DOOM, EDORAS, MORIA, WELLINGHALL, BANDIT_LAIR,
  makeMHState, dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const SKINBARK = 'tw-328' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Skinbark (tw-328)', () => {
  beforeEach(() => resetMint());

  test('Skinbark is discarded when company moves to a site outside allowed regions', () => {
    // Minas Tirith is in Anórien — not in Skinbark's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withSkinbark = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, SKINBARK);

    const skinbarkInstId = withSkinbark.players[0].characters[
      (Object.keys(withSkinbark.players[0].characters) as CardInstanceId[])[0]
    ].allies[0].instanceId;

    // Set destination to Minas Tirith (region Anórien — disallowed)
    const minasTirithCard = withSkinbark.players[0].siteDeck[0];
    const withDest = {
      ...withSkinbark,
      players: [
        {
          ...withSkinbark.players[0],
          companies: [{
            ...withSkinbark.players[0].companies[0],
            destinationSite: { instanceId: minasTirithCard.instanceId, definitionId: minasTirithCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withSkinbark.players[1],
      ] as typeof withSkinbark.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    // Both players pass → endCompanyMH → fireCompanyArrivesAtSite
    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Skinbark should be in discard pile
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === skinbarkInstId,
    );
    expect(inDiscard).toBe(true);

    // Skinbark should no longer be attached to Aragorn
    const charId = (Object.keys(afterHazardPass.players[0].characters) as CardInstanceId[])[0];
    const char = afterHazardPass.players[0].characters[charId];
    const allyStillAttached = char.allies.some(a => a.instanceId === skinbarkInstId);
    expect(allyStillAttached).toBe(false);
  });

  test('Skinbark stays when company moves to a site in an allowed region', () => {
    // Edoras is in Rohan — in Skinbark's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withSkinbark = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, SKINBARK);

    const skinbarkInstId = withSkinbark.players[0].characters[
      (Object.keys(withSkinbark.players[0].characters) as CardInstanceId[])[0]
    ].allies[0].instanceId;

    // Set destination to Edoras (region Rohan — allowed)
    const edorasCard = withSkinbark.players[0].siteDeck[0];
    const withDest = {
      ...withSkinbark,
      players: [
        {
          ...withSkinbark.players[0],
          companies: [{
            ...withSkinbark.players[0].companies[0],
            destinationSite: { instanceId: edorasCard.instanceId, definitionId: edorasCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withSkinbark.players[1],
      ] as typeof withSkinbark.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    // Both players pass → endCompanyMH → fireCompanyArrivesAtSite
    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Skinbark should NOT be in discard pile
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === skinbarkInstId,
    );
    expect(inDiscard).toBe(false);

    // Skinbark should still be attached to Aragorn
    const charId = (Object.keys(afterHazardPass.players[0].characters) as CardInstanceId[])[0];
    const char = afterHazardPass.players[0].characters[charId];
    const allyStillAttached = char.allies.some(a => a.instanceId === skinbarkInstId);
    expect(allyStillAttached).toBe(true);
  });

  test('Skinbark stays when company moves to Moria (Redhorn Gate — allowed)', () => {
    // Moria is in Redhorn Gate — in Skinbark's allowed regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withSkinbark = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, SKINBARK);

    const skinbarkInstId = withSkinbark.players[0].characters[
      (Object.keys(withSkinbark.players[0].characters) as CardInstanceId[])[0]
    ].allies[0].instanceId;

    // Set destination to Moria (region Redhorn Gate — allowed)
    const moriaCard = withSkinbark.players[0].siteDeck[0];
    const withDest = {
      ...withSkinbark,
      players: [
        {
          ...withSkinbark.players[0],
          companies: [{
            ...withSkinbark.players[0].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withSkinbark.players[1],
      ] as typeof withSkinbark.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Skinbark should stay
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === skinbarkInstId,
    );
    expect(inDiscard).toBe(false);

    const charId = (Object.keys(afterHazardPass.players[0].characters) as CardInstanceId[])[0];
    const char = afterHazardPass.players[0].characters[charId];
    expect(char.allies.some(a => a.instanceId === skinbarkInstId)).toBe(true);
  });

  test('Skinbark is discarded when company moves to Bandit Lair (Brown Lands — allowed for Treebeard, not for Skinbark)', () => {
    // Bandit Lair is in Brown Lands, which is in Treebeard's list but NOT in
    // Skinbark's narrower allowed-region list.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [BANDIT_LAIR] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const withSkinbark = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, SKINBARK);

    const skinbarkInstId = withSkinbark.players[0].characters[
      (Object.keys(withSkinbark.players[0].characters) as CardInstanceId[])[0]
    ].allies[0].instanceId;

    const banditLairCard = withSkinbark.players[0].siteDeck[0];
    const withDest = {
      ...withSkinbark,
      players: [
        {
          ...withSkinbark.players[0],
          companies: [{
            ...withSkinbark.players[0].companies[0],
            destinationSite: { instanceId: banditLairCard.instanceId, definitionId: banditLairCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        withSkinbark.players[1],
      ] as typeof withSkinbark.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withDest, phaseState: mhState };

    const afterResourcePass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Skinbark should be discarded (unlike Treebeard, who would stay here)
    const inDiscard = afterHazardPass.players[0].discardPile.some(
      c => c.instanceId === skinbarkInstId,
    );
    expect(inDiscard).toBe(true);
  });

  // ─── Immunity to automatic-attacks ────────────────────────────────────────

  test('Skinbark is NOT offered as a defender strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withSkinbark = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, SKINBARK);
    const withCombat = makeCancelWindowCombat(withSkinbark, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const skinbarkInstanceId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(skinbarkInstanceId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === skinbarkInstanceId)).toBe(false);
  });
});
