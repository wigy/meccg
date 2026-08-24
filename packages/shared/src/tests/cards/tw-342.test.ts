/**
 * @module tw-342.test
 *
 * Card test: The Cock Crows (tw-342)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancels one Troll attack (no tap cost)
 *   2. move (discard-in-play) — if Gates of Morning is in play, discard one
 *      hazard permanent-event; gated by `when: { inPlay: "Gates of Morning" }`
 *
 * "Cancels a Troll attack. Alternatively, if Gates of Morning is in play,
 *  discard one hazard permanent-event."
 *
 * Engine notes:
 * - cancel-attack with when condition: fully implemented.
 * - discard-in-play move effect with when gate: organization.ts and long-event.ts
 *   both now check the `when` condition on move effects before enumerating targets,
 *   so the card is only offered as a non-combat action when GoM is in play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  BERT_BURAT, ORC_PATROL,
  GATES_OF_MORNING, FOOLISH_WORDS, LURE_OF_THE_SENSES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  attachHazardToChar,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, PlayShortEventAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { RegionType, SiteType, computeLegalActions } from '../../index.js';

const THE_COCK_CROWS = 'tw-342' as CardDefinitionId;

describe('The Cock Crows (tw-342)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack available against Troll attack (Bert)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const bertId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, bertId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
  });

  test('cancel-attack NOT available against non-Troll attack (Orc Patrol)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack discards The Cock Crows and cancels combat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const bertId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, bertId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const declared = dispatch(combatState, cancelActions[0].action);

    // Chain declared — combat still active until resolved
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, THE_COCK_CROWS);

    // Resolving the chain cancels combat
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectInDiscardPile(after, HAZARD_PLAYER, BERT_BURAT);
  });

  test('not playable outside combat when Gates of Morning is NOT in play', () => {
    // Without GoM the only effect is cancel-attack (combat-only), so the
    // card should not appear as playable during the long-event phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const shortEventActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-short-event');
    expect(shortEventActions).toHaveLength(0);
  });

  test('discard mode available during long-event phase when GoM is in play and hazard perm-event exists', () => {
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach Foolish Words (hazard permanent-event) to Aragorn — a hazard
    // event always ends up on whoever was moving when it was played (CoE
    // 2.IV.vii.3), so the discard-in-play target must be the caster's own
    // character, not the opponent's (see bug dcfcd0c823ac4c71).
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);

    const action = playActions[0].action as PlayShortEventAction;
    expect(action.discardTargetInstanceId).toBeDefined();
    // No tap cost — no targetScoutInstanceId
    expect(action.targetScoutInstanceId).toBeUndefined();
  });

  test('discard mode NOT available when GoM in play but no hazard permanent-events exist', () => {
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('discard mode: playing discards the hazard permanent-event and The Cock Crows', () => {
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach to Aragorn (the caster's own character) — a hazard event
    // always ends up on whoever was moving when it was played (CoE
    // 2.IV.vii.3), owned here by the hazard player (see bug dcfcd0c823ac4c71).
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS, HAZARD_PLAYER);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);

    const after = resolveChain(dispatch(state, playActions[0].action));

    // The Cock Crows discarded after use
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, THE_COCK_CROWS);

    // Foolish Words removed from Aragorn and sent to hazard player's discard pile
    const aragornChar = Object.values(after.players[0].characters)[0];
    expect(aragornChar.hazards).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, FOOLISH_WORDS);
  });

  test('discard mode: hazard on resource-player character goes to hazard player discard, not resource player', () => {
    // Regression test: Lure of the Senses (hazard owned by p2) was attached to Aragorn
    // (p1's character). The Cock Crows discarded it but it ended up in p1's discardPile
    // instead of p2's. The fix uses ownerOf(instanceId) to route to the card owner's pile.
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach Lure of the Senses to ARAGORN (resource player's character), owned by the hazard player.
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);

    const after = resolveChain(dispatch(state, playActions[0].action));

    // The Cock Crows discarded after use
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, THE_COCK_CROWS);

    // Lure of the Senses removed from Aragorn
    const aragornChar = Object.values(after.players[RESOURCE_PLAYER].characters)[0];
    expect(aragornChar.hazards).toHaveLength(0);

    // Lure of the Senses must go to the hazard player's discard pile, not the resource player's
    expectInDiscardPile(after, HAZARD_PLAYER, LURE_OF_THE_SENSES);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LURE_OF_THE_SENSES)).toBe(false);
  });

  test('multiple hazard perm-events: one discard action per target', () => {
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach two separate hazard permanent-events to two of the caster's own
    // characters — a hazard event always ends up on whoever was moving when
    // it was played (CoE 2.IV.vii.3), never the opponent's (bug dcfcd0c823ac4c71).
    const withFirst = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    const state = attachHazardToChar(withFirst, RESOURCE_PLAYER, GIMLI, LURE_OF_THE_SENSES);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // One action per valid discard target (both FOOLISH_WORDS and LURE_OF_THE_SENSES)
    expect(playActions).toHaveLength(2);

    const discardTargets = playActions.map(a => (a.action as PlayShortEventAction).discardTargetInstanceId);
    expect(new Set(discardTargets).size).toBe(2);
  });

  test('discard mode does not cancel an unrelated non-Troll attack in progress (bug 80b01c8ac7c2faff)', () => {
    // Regression: a Chill Douser (Undead) attack was wiped out mid
    // strike-assignment after its defender played The Cock Crows in its
    // discard-in-play mode (GoM in play, discarding an unrelated hazard
    // permanent-event) — the chain resolver fired the card's cancel-attack
    // effect too, purely because the card *defines* one, even though the
    // played action never invoked it (cancel-attack isn't legal against a
    // non-Troll attack in the first place). Orc Patrol stands in for the
    // non-Troll attacker here.
    const gomInPlay: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_COCK_CROWS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS, HAZARD_PLAYER);

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...withHazard, phaseState: mhState };

    const orcId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    // Cancel-attack is not legal (Orc Patrol is not a Troll) — only the
    // discard-mode play-short-event should be offered.
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    const playActions = viableActions(combatState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as PlayShortEventAction;
    expect(action.discardTargetInstanceId).toBeDefined();

    const after = resolveChain(dispatch(combatState, action));

    // The unrelated attack must survive; only the targeted permanent-event
    // was discarded.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');
    expectInDiscardPile(after, HAZARD_PLAYER, FOOLISH_WORDS);
    expectInDiscardPile(after, RESOURCE_PLAYER, THE_COCK_CROWS);
  });
});
