/**
 * @module dm-109.test
 *
 * Card test: Nameless Thing (dm-109)
 * Type: hazard-creature (drake)
 *
 * Text:
 *   "Drake. 3 attacks of 2 strikes each. A character can tap to cancel one
 *    of these attacks. Playable at any Under-deeps site. If Doors of Night
 *    is in play, also playable at an adjacent site of any Under-deeps site
 *    or keyed to a Coastal Sea [{c}]."
 *
 * Base stats: strikes 2, prowess 10, body 4, kill MP 3.
 *
 * Engine Support:
 * | # | Rule                                                     | Status      | Notes                                                  |
 * |---|----------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Drake (race)                                             | IMPLEMENTED | race field used by race-gated interactions             |
 * | 2 | 3 attacks of 2 strikes each (strikesTotal = 6)           | IMPLEMENTED | combat-multi-attack count:3 × strikes:2                |
 * | 3 | A character can tap to cancel one of these attacks        | IMPLEMENTED | combat-cancel-attack-by-tap maxCancels:1               |
 * |   |   — one tap removes one full 2-strike attack              |             | strikesPerAttack:2 removes 2 assignments per tap       |
 * | 4 | Playable at any Under-deeps site (base keying)           | IMPLEMENTED | siteKeywords:["under-deeps"] in keyedTo                |
 * | 5 | (with DoN) playable at adjacent site of Under-deeps site | IMPLEMENTED | adjacentToSiteKeywords:["under-deeps"] with DoN when   |
 * | 6 | (with DoN) playable keyed to a Coastal Sea [{c}]         | IMPLEMENTED | regionTypes:["coastal"] with DoN when                  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  makeMHState,
  viableActionsForHandCard,
  playCreatureHazardAndResolve, resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const NAMELESS_THING = 'dm-109' as CardDefinitionId;

// Under-deeps site: The Under-gates (dm-38) — shadow-hold, adjacent to Moria
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;
// Under-deeps site: The Under-vaults (dm-41) — ruins-and-lairs, adjacent to Mount Gram (tw-415)
const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId;
// Surface site adjacent to The Under-vaults (cost 0 adjacency)
const MOUNT_GRAM = 'tw-415' as CardDefinitionId;
// Surface site adjacent to The Iron-deeps (dm-33)
const CARN_DUM = 'tw-380' as CardDefinitionId;

function baseStateWithHazardInHand(
  cardsInPlay?: Array<{ instanceId: CardInstanceId; definitionId: CardDefinitionId; status: CardStatus }>,
) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH, THE_UNDER_GATES, THE_UNDER_VAULTS, MOUNT_GRAM, CARN_DUM],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [NAMELESS_THING],
        siteDeck: [RIVENDELL],
        cardsInPlay: cardsInPlay ?? [],
      },
    ],
  });
}

function donInPlay() {
  return {
    instanceId: 'don-1' as CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };
}

describe('Nameless Thing (dm-109)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: base Under-deeps site ──────────────────────────────────────────

  test('playable at an Under-deeps destination site — The Under-gates (shadow-hold)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
    const a = actions[0].action as { keyedBy?: { method: string; value: string } };
    expect(a.keyedBy?.method).toBe('site-keyword');
    expect(a.keyedBy?.value).toBe('under-deeps');
  });

  test('playable at another Under-deeps site — The Under-vaults (ruins-and-lairs)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-vaults',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
  });

  test('NOT playable at a surface site without Doors of Night', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Mount Gram',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(0);
  });

  test('NOT playable via wilderness path without Doors of Night', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Weathertop',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(0);
  });

  // ─── Keying: DoN — adjacent surface site ────────────────────────────────────

  test('with Doors of Night, playable at a surface site adjacent to an Under-deeps site', () => {
    // Mount Gram is the surface entry point for The Under-vaults (dm-41)
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Mount Gram',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
    const a = actions[0].action as { keyedBy?: { method: string; value: string } };
    expect(a.keyedBy?.method).toBe('adjacent-to-site-keyword');
    expect(a.keyedBy?.value).toBe('under-deeps');
  });

  test('without Doors of Night, NOT playable at a surface site adjacent to Under-deeps', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Mount Gram',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(0);
  });

  test('with Doors of Night, playable at another surface site adjacent to Under-deeps (Carn Dum)', () => {
    // Carn Dûm (tw-380) is the surface entry for The Iron-deeps (dm-33)
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Gundabad'],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Carn Dûm',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
  });

  // ─── Keying: DoN — Coastal Sea ──────────────────────────────────────────────

  test('with Doors of Night, playable via a Coastal Sea path', () => {
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
        resolvedSitePathNames: ['Andrast', 'Anfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Dol Amroth',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(1);
    expect(actions[0].viable).toBe(true);
    const a = actions[0].action as { keyedBy?: { method: string; value: string } };
    expect(a.keyedBy?.method).toBe('region-type');
    expect(a.keyedBy?.value).toBe('coastal');
  });

  test('without Doors of Night, NOT playable via a Coastal Sea path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
        resolvedSitePathNames: ['Andrast', 'Anfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Dol Amroth',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, NAMELESS_THING);
    expect(actions).toHaveLength(0);
  });

  // ─── Combat: multi-attack (3 attacks × 2 strikes = 6 total) ─────────────────

  test('combat initiates with strikesTotal = 6, prowess 10, strikesPerAttack = 2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH, THE_UNDER_GATES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NAMELESS_THING],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'site-keyword', value: 'under-deeps' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(6);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.multiAttackCount).toBe(3);
    expect(afterChain.combat!.strikesPerAttack).toBe(2);
    expect(afterChain.combat!.cancelByTapRemaining).toBe(1);
  });

  test('a chain-resolved cancel of one attack removes the full 2-strike allotment (6 → 4)', () => {
    // Regression: the chain-resolution cancel path decremented strikesTotal
    // by 1 instead of strikesPerAttack, leaving 5 strikes where the rules say
    // 4 (and drifting from multiAttackCount × strikesPerAttack).
    const NOT_AT_HOME = 'td-143' as CardDefinitionId; // cancels a site-keyed Drake attack
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [NOT_AT_HOME],
          siteDeck: [MINAS_TIRITH, THE_UNDER_GATES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NAMELESS_THING],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const inCombat = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'site-keyword', value: 'under-deeps' },
    );
    expect(inCombat.combat!.strikesTotal).toBe(6);

    const cancels = computeLegalActions(inCombat, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack',
    );
    expect(cancels.length).toBeGreaterThan(0);
    const after = resolveChain(dispatch(inCombat, cancels[0].action));

    // One attack canceled: combat continues with 2 attacks × 2 strikes.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(4); // NOT 5
    expect(after.combat!.multiAttackCount).toBe(2);
  });

  // ─── Combat: cancel-by-tap cancels one full 2-strike attack ─────────────────

  test('defender taps one non-target character to cancel one attack (removes 2 strikes)', () => {
    // Two-character company: Aragorn + Legolas
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH, THE_UNDER_GATES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [NAMELESS_THING],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Play creature and resolve chain
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'site-keyword', value: 'under-deeps' },
    );

    // P2 (attacker) assigns all 6 strikes to Aragorn (forceSingleTarget)
    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 1);
    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });

    // Now in cancel-by-tap sub-phase
    expect(afterAssign.combat!.assignmentPhase).toBe('cancel-by-tap');
    expect(afterAssign.combat!.strikesTotal).toBe(6);
    expect(afterAssign.combat!.cancelByTapRemaining).toBe(1);

    // P1 (defender) sees cancel-by-tap action for Legolas (not Aragorn — target)
    const defActions = computeLegalActions(afterAssign, PLAYER_1);
    const cancelActions = defActions.filter(a => a.viable && a.action.type === 'cancel-by-tap');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as { characterId: CardInstanceId };
    expect(cancelAction.characterId).toBe(legolasId);

    // Tap Legolas — should cancel one full attack (2 strikes)
    const afterCancel = dispatch(afterAssign, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasId,
    });

    expect(afterCancel.combat!.strikesTotal).toBe(4);
    expect(afterCancel.combat!.strikeAssignments).toHaveLength(4);
    // cancelByTapRemaining is undefined (exhausted) after the last cancel
    expect(afterCancel.combat!.cancelByTapRemaining ?? 0).toBe(0);
  });

  test('only one attack may be canceled by tap — no second cancel-by-tap action after first', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH, THE_UNDER_GATES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [NAMELESS_THING],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
      }),
    };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'site-keyword', value: 'under-deeps' },
    );

    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 1);
    const gimliId = charIdAt(afterChain, RESOURCE_PLAYER, 0, 2);
    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });
    expect(afterAssign.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Tap Legolas — first (and only) cancel
    const afterCancel = dispatch(afterAssign, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasId,
    });
    // cancelByTapRemaining is undefined (exhausted) after the last cancel
    expect(afterCancel.combat!.cancelByTapRemaining ?? 0).toBe(0);

    // No more cancel-by-tap actions available
    const postCancelActions = computeLegalActions(afterCancel, PLAYER_1);
    const remainingCancels = postCancelActions.filter(a => a.viable && a.action.type === 'cancel-by-tap');
    expect(remainingCancels).toHaveLength(0);

    // Gimli still untapped, but cancel exhausted — no cancel action for Gimli either
    const gimliCancelActions = postCancelActions.filter(a => {
      if (a.action.type !== 'cancel-by-tap') return false;
      const ca = a.action as { characterId: CardInstanceId };
      return ca.characterId === gimliId;
    });
    expect(gimliCancelActions).toHaveLength(0);
  });
});
