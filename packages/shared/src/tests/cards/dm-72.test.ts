/**
 * @module dm-72.test
 *
 * Card test: Mordor in Arms (dm-72)
 * Type: hazard-event (permanent), non-unique, 2 kill MP
 *
 * "Any company moving in Nurn faces three attacks: Orcs — 5 strikes with 8
 *  prowess, Orcs — 4 strikes with 10 prowess, Trolls — 3 strikes with 12
 *  prowess. If all three attacks are defeated by your opponent, he receives
 *  this card in his MP pile and 2 kill MPs. Any attempt by a character to
 *  influence a faction playable at a site in Horse Plains, Khand, Harondor,
 *  Nurn, Gorgoroth, Imlad Morgul, or Udûn is modified by -6 and cannot be done
 *  with Muster. This card has no effect on a minion player."
 *
 * Effects (5):
 *   - ahunt-attack ×3 keyed to Nurn (Orc 5/8, Orc 4/10, Troll 3/12); the last
 *     carries `groupReward.toDefenderKillPile`, all carry `noEffectOnMinion`.
 *   - mp-in-pile (kill, 2) — scores when the card reaches a kill pile.
 *   - faction-influence-restriction: -6 at the seven named regions, blocks
 *     Muster, `noEffectOnMinion`.
 *
 * Every rule is exercised against the engine below (no tautological assertions).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  buildAhuntOrderEffectsState, buildSitePhaseState, buildTestState, makeSitePhase,
  addCardInPlay, findCharInstanceId, firstFactionInfluenceAttempt, runAhuntSequence,
  viableActions, dispatch, resolveChain,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, LEGOLAS,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import { RegionType, Alignment, Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState } from '../../index.js';

const MORDOR_IN_ARMS = 'dm-72' as CardDefinitionId;

// Hero fixtures for the influence-penalty tests (non-minion influencer).
const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;       // region: Horse Plains (a named region)
const WAIN_EASTERLINGS = 'as-60' as CardDefinitionId;       // hero faction, influence # 9, playable there
const MUSTER = 'tw-288' as CardDefinitionId;

// Minion fixtures for the minion-immunity influence test.
const LAGDUF = 'le-18' as CardDefinitionId;                 // minion orc, DI 0, no effects
const VARIAG_CAMP = 'le-411' as CardDefinitionId;           // region: Khand (a named region)
const VARIAGS_OF_KHAND = 'le-292' as CardDefinitionId;      // minion faction, influence # 9

const PATH_NURN = { pathNames: ['Nurn'], pathTypes: [RegionType.Dark] } as const;
const PATH_ELSEWHERE = { pathNames: ['Gorgoroth'], pathTypes: [RegionType.Dark] } as const;

describe('Mordor in Arms (dm-72)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: three region attacks in Nurn ──────────────────────────────────

  test('company moving in Nurn faces the first attack (Orcs 5 strikes / 8 prowess)', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(5);
    expect(combat.strikeProwess).toBe(8);
    expect(combat.creatureRace).toBe('orc');
    // No printed body → no "body check vs creature" on defeat.
    expect(combat.creatureBody).toBeNull();
  });

  test('all three attacks fire in order: Orc 5/8, Orc 4/10, Troll 3/12', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const start = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    const { combats } = runAhuntSequence(start, 12);
    expect(combats).toEqual([
      { strikes: 5, prowess: 8, race: 'orc', body: null },
      { strikes: 4, prowess: 10, race: 'orc', body: null },
      { strikes: 3, prowess: 12, race: 'troll', body: null },
    ]);
  });

  test('company moving elsewhere (not Nurn) faces no attack', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_ELSEWHERE });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ── Rule 1b: group reward when all three attacks are defeated ──────────────

  test('defeating all three attacks moves the card to the mover\'s kill pile for 2 kill MP', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const start = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    const { end } = runAhuntSequence(start, 12); // high roll → every strike defeated
    expect(end.combat).toBeNull();

    // Card left the hazard player's play area and entered the mover's kill pile.
    expect(end.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === MORDOR_IN_ARMS)).toBe(false);
    expect(end.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === MORDOR_IN_ARMS)).toBe(true);
    // mp-in-pile scores 2 kill MP for the mover.
    expect(end.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(2);
  });

  test('if not all attacks are defeated, no reward — the card stays in play', () => {
    const state = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const start = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    // Roll 6: Orc attacks (8/10 prowess) are defeated, but the Troll attack
    // (12 prowess) strikes succeed, so the group is not fully defeated.
    const { end } = runAhuntSequence(start, 6);
    expect(end.combat).toBeNull();

    expect(end.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === MORDOR_IN_ARMS)).toBe(true);
    expect(end.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === MORDOR_IN_ARMS)).toBe(false);
    expect(end.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(0);
  });

  // ── Rule 3 (attacks): no effect on a minion player ────────────────────────

  test('a minion company moving in Nurn faces no attacks (no effect on minion player)', () => {
    const base = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], alignment: Alignment.Ringwraith },
        base.players[1],
      ] as typeof base.players,
    };
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('a Balrog company moving in Nurn faces no attacks either (the Balrog is a minion player)', () => {
    // Regression: the ahunt "no effect on a minion player" gate tested only
    // Ringwraith alignment, so a Balrog company faced all three attacks —
    // while the SAME card's -6 influence clause already exempted the Balrog
    // via the canonical isMinionOrBalrog reading.
    const base = buildAhuntOrderEffectsState({ ahuntDefId: MORDOR_IN_ARMS, ...PATH_NURN });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], alignment: Alignment.Balrog },
        base.players[1],
      ] as typeof base.players,
    };
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ── Rule 2: -6 faction influence at named regions ─────────────────────────

  test('faction influence at a named region is modified by -6 (raises need)', () => {
    const base = buildSitePhaseState({ characters: [LEGOLAS], site: EASTERLING_CAMP, hand: [WAIN_EASTERLINGS] });
    const factionInst = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    // Baseline: influence # 9 − DI(2) = 7.
    expect(firstFactionInfluenceAttempt(base, factionInst)!.need).toBe(7);

    // With Mordor in Arms in play: 9 − (DI 2 − 6) = 13.
    const withMordor = addCardInPlay(base, HAZARD_PLAYER, MORDOR_IN_ARMS);
    expect(firstFactionInfluenceAttempt(withMordor, factionInst)!.need).toBe(13);
  });

  test('the -6 penalty flips a would-be successful influence roll into a failure', () => {
    const base = buildSitePhaseState({ characters: [LEGOLAS], site: EASTERLING_CAMP, hand: [WAIN_EASTERLINGS] });
    const factionInst = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    // roll 7 + DI 2 = 9 ≥ 9 → succeeds without Mordor.
    const attemptA = firstFactionInfluenceAttempt(base, factionInst)!;
    const afterChainA = resolveChain(dispatch(base, attemptA));
    const rollA = viableActions(afterChainA, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolvedA = dispatch({ ...afterChainA, cheatRollTotal: 7 }, rollA);
    expect(resolvedA.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInst)).toBe(true);

    // Same roll with Mordor in play: 7 + (2 − 6) = 3 < 9 → fails.
    const withMordor = addCardInPlay(base, HAZARD_PLAYER, MORDOR_IN_ARMS);
    const attemptB = firstFactionInfluenceAttempt(withMordor, factionInst)!;
    const afterChainB = resolveChain(dispatch(withMordor, attemptB));
    const rollB = viableActions(afterChainB, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolvedB = dispatch({ ...afterChainB, cheatRollTotal: 7 }, rollB);
    expect(resolvedB.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInst)).toBe(false);
  });

  // ── Rule 2: cannot be done with Muster ────────────────────────────────────

  test('Muster\'s influence boost is suppressed at a named region while Mordor is in play', () => {
    const base = buildSitePhaseState({ characters: [LEGOLAS], site: EASTERLING_CAMP, hand: [WAIN_EASTERLINGS] });
    const factionInst = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);

    // A Muster boost (+5) applied to the influencer.
    const withMuster = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: legolasId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });
    // Without Mordor: Muster applies → need 9 − (DI 2 + 5) = 2.
    expect(firstFactionInfluenceAttempt(withMuster, factionInst)!.need).toBe(2);

    // With Mordor in play: Muster suppressed, −6 applies → need 9 − (2 − 6) = 13.
    const withBoth = addCardInPlay(withMuster, HAZARD_PLAYER, MORDOR_IN_ARMS);
    expect(firstFactionInfluenceAttempt(withBoth, factionInst)!.need).toBe(13);
  });

  // ── Rule 3 (influence): no effect on a minion influencer ──────────────────

  test('a minion influencer at a named region is not penalised (no effect on minion player)', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: VARIAG_CAMP, characters: [LAGDUF] }], hand: [VARIAGS_OF_KHAND], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: EASTERLING_CAMP, characters: [] }], hand: [], siteDeck: [EASTERLING_CAMP] },
      ],
    });
    const base: GameState = { ...built, phaseState: makeSitePhase() };
    const factionInst = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const baselineNeed = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withMordor = addCardInPlay(base, HAZARD_PLAYER, MORDOR_IN_ARMS);
    // Immunity: the -6 does not apply to a minion influencer, so need is unchanged.
    expect(firstFactionInfluenceAttempt(withMordor, factionInst)!.need).toBe(baselineNeed);
  });
});
