/**
 * @module dm-80.test
 *
 * Card test: Rank upon Rank (dm-80)
 * Type: hazard-event (permanent)
 * Effects: 6
 *   1. stat-modifier prowess +1 to all Man attacks (non-agent: gated on
 *      `attack.isAgentAttack $ne true`, since agent hazard attacks do go through
 *      the global all-attacks modifiers — see Chill Them with Fear le-106)
 *   2. stat-modifier strikes +1 to all Man attacks
 *   3. stat-modifier prowess +1 to all Giant attacks when Doors of Night is in play
 *   4. stat-modifier strikes +1 to all Giant attacks when Doors of Night is in play
 *   5. on-event: attack-defeated — discard self when an affected (Man or Giant + DoN) attack is defeated
 *   6. duplication-limit scope: game max: 1 — cannot be duplicated
 *
 * Card text:
 *   "All non-agent Man attacks receive +1 prowess and +1 strikes. If Doors of Night
 *   is in play, all Giant attacks also receive these bonuses. Discard this card when
 *   such an affected attack (automatic, hazard creature, or otherwise) is defeated.
 *   Cannot be duplicated."
 *
 * Test fixtures:
 *   - Bandit Lair (tw-373): Men auto-attack — 3 strikes, 6 prowess.
 *     With Rank upon Rank: 4 strikes, 7 prowess.
 *   - Giant (tw-39): hazard creature — Giants, 1 strike, 13 prowess, keyed {w}{w}.
 *     With Rank upon Rank + Doors of Night: 2 strikes, 14 prowess.
 *
 * | # | Effect                                         | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | stat-modifier prowess +1 (Man, non-agent)      | IMPLEMENTED | target: all-attacks; enemy.race normalised   |
 * | 2 | stat-modifier strikes +1 (Man)                 | IMPLEMENTED | target: all-attacks                          |
 * | 3 | stat-modifier prowess +1 (Giant + DoN)         | IMPLEMENTED | inPlay condition in buildAttackContext       |
 * | 4 | stat-modifier strikes +1 (Giant + DoN)         | IMPLEMENTED | inPlay condition in buildAttackContext       |
 * | 5 | on-event: attack-defeated, discard             | IMPLEMENTED | reducer-combat.ts allDefeated + inPlay ctx   |
 * | 6 | duplication-limit (game, max 1)                | IMPLEMENTED | reducer.ts duplicate-check                   |
 *
 * Playable: YES
 * Certified: 2026-05-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  Phase,
  viableActions,
  makeMHState, makeDoubleWildernessMHState, makeSitePhase,
  makeAgent, withAgentInPlay,
  handCardId, companyIdAt, dispatch, resolveChain,
  findCharInstanceId,
  BANDIT_LAIR, DOORS_OF_NIGHT,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardInPlay, CardInstanceId, CardDefinitionId, DeclareAgentAttackAction,
} from '../../index.js';

const RANK_UPON_RANK = 'dm-80' as CardDefinitionId;
const GIANT = 'tw-39' as CardDefinitionId;
const ELERINA = 'dm-7' as CardDefinitionId;   // Man agent, prowess 5
const AGENT_SITE_ID = 'test-dm80-agent-site' as CardInstanceId;

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const rankInPlay: CardInPlay = {
  instanceId: 'rank-1' as CardInstanceId,
  definitionId: RANK_UPON_RANK,
  status: CardStatus.Untapped,
};

const doorsInPlay: CardInPlay = {
  instanceId: 'doors-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rank upon Rank (dm-80)', () => {
  beforeEach(() => resetMint());

  // ── Man auto-attack prowess and strikes boosts ─────────────────────────────

  test('Man auto-attack prowess increased by +1 (6 → 7)', () => {
    // Bandit Lair: Men — 3 strikes, 6 prowess
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BANDIT_LAIR }), [rankInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test('Man auto-attack strikes increased by +1 (3 → 4)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BANDIT_LAIR }), [rankInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
  });

  test('non-Man auto-attack is unaffected (Undead at Gladden Fields)', () => {
    // Gladden Fields: Undead — 1 strike, 8 prowess (not Man → no boost)
    const GLADDEN_FIELDS = 'tw-396' as CardDefinitionId;
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GLADDEN_FIELDS }), [rankInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.strikesTotal).toBe(1);
  });

  // ── Giant hazard creature boosts (conditional on Doors of Night) ───────────

  test('Giant hazard creature prowess +1 when Doors of Night in play (13 → 14)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GIANT], siteDeck: [MORIA], cardsInPlay: [rankInPlay, doorsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeDoubleWildernessMHState() };

    const after = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(after);

    expect(afterChain.combat).toBeDefined();
    expect(afterChain.combat!.strikeProwess).toBe(14);
  });

  test('Giant hazard creature strikes +1 when Doors of Night in play (1 → 2)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GIANT], siteDeck: [MORIA], cardsInPlay: [rankInPlay, doorsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeDoubleWildernessMHState() };

    const after = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(after);

    expect(afterChain.combat).toBeDefined();
    expect(afterChain.combat!.strikesTotal).toBe(2);
  });

  test('Giant hazard creature unaffected when Doors of Night not in play (prowess 13, strikes 1)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GIANT], siteDeck: [MORIA], cardsInPlay: [rankInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeDoubleWildernessMHState() };

    const after = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(after);

    expect(afterChain.combat).toBeDefined();
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });

  // ── Discard when affected Man auto-attack is defeated ─────────────────────

  test('discards itself when all strikes of a Man auto-attack are defeated', () => {
    // Bandit Lair with Rank upon Rank: 4 strikes, 7 prowess.
    // 4 characters needed to defeat all 4 strikes.
    // Roll 12 + character prowess > 7 on all → every character succeeds.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(
        buildSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN, LEGOLAS, GIMLI, FARAMIR] }),
        [rankInPlay],
      ),
    );

    // Trigger auto-attack (4 strikes, 7 prowess)
    let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(s.combat?.strikesTotal).toBe(4);

    // Assign all 4 strikes to different characters
    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const legolasId = findCharInstanceId(s, 0, LEGOLAS);
    const gimliId   = findCharInstanceId(s, 0, GIMLI);
    const faramirId = findCharInstanceId(s, 0, FARAMIR);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    expect(s.combat?.phase).toBe('choose-strike-order');

    // Resolve all 4 strikes: 3 need choose-strike-order, last is auto-selected.
    // Each iteration: choose order (if multiple unresolved), then resolve one.
    for (let i = 0; i < 4; i++) {
      const orderActions = viableActions(s, PLAYER_1, 'choose-strike-order');
      if (orderActions.length > 0) {
        s = dispatch(s, orderActions[0].action);
      }
      const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(resolveActions.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    // allDefeated = true → Rank upon Rank fires attack-defeated → discarded
    expect(s.players[1].cardsInPlay.map(c => c.definitionId)).not.toContain(RANK_UPON_RANK);
    expect(s.players[1].discardPile.map(c => c.definitionId)).toContain(RANK_UPON_RANK);
  });

  // ── Discard when Giant attack defeated (only if Doors of Night in play) ───

  test('discards itself when Giant hazard attack defeated and Doors of Night in play', () => {
    // Giant + DoN: 2 strikes, 14 prowess. Two characters (ARAGORN, LEGOLAS) each face 1 strike.
    // Roll 12: Aragorn (prowess 3) → 15 > 14 ✓; Legolas (prowess 6) → 18 > 14 ✓.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GIANT], siteDeck: [MORIA], cardsInPlay: [rankInPlay, doorsInPlay] },
      ],
    });
    let s = resolveChain(dispatch({ ...base, phaseState: makeDoubleWildernessMHState() }, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId({ ...base, phaseState: makeDoubleWildernessMHState() }, HAZARD_PLAYER),
      targetCompanyId: companyIdAt({ ...base, phaseState: makeDoubleWildernessMHState() }, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    }));
    expect(s.combat?.strikesTotal).toBe(2);

    // Assign strikes and resolve
    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    const legolasId = findCharInstanceId(s, 0, LEGOLAS);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    expect(s.combat?.phase).toBe('choose-strike-order');

    // Choose first striker, resolve, then last auto-resolves
    const orderActions = viableActions(s, PLAYER_1, 'choose-strike-order');
    expect(orderActions.length).toBeGreaterThan(0);
    s = dispatch(s, orderActions[0].action);
    s = dispatch({ ...s, cheatRollTotal: 12 }, viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike')[0].action);
    s = dispatch({ ...s, cheatRollTotal: 12 }, viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike')[0].action);

    // allDefeated + Giant + DoN in play → Rank upon Rank discarded
    expect(s.players[1].cardsInPlay.map(c => c.definitionId)).not.toContain(RANK_UPON_RANK);
    expect(s.players[1].discardPile.map(c => c.definitionId)).toContain(RANK_UPON_RANK);
  });

  test('does NOT discard when Giant attack defeated but Doors of Night not in play', () => {
    // Giant without DoN: 1 strike, 13 prowess. Roll 12: Aragorn 15 > 13 → wins.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GIANT], siteDeck: [MORIA], cardsInPlay: [rankInPlay] },
      ],
    });
    const stateWithPath = { ...base, phaseState: makeDoubleWildernessMHState() };
    let s = resolveChain(dispatch(stateWithPath, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(stateWithPath, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(stateWithPath, RESOURCE_PLAYER),
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    }));
    expect(s.combat?.strikesTotal).toBe(1);

    const aragornId = findCharInstanceId(s, 0, ARAGORN);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch({ ...s, cheatRollTotal: 12 }, viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike')[0].action);

    // Giant defeated but no DoN → Rank upon Rank should remain in cardsInPlay
    expect(s.players[1].cardsInPlay.map(c => c.definitionId)).toContain(RANK_UPON_RANK);
  });

  // ── "non-agent": an agent hazard attack is never boosted ──────────────────

  test('a Man agent attack is NOT boosted ("all non-agent Man attacks")', () => {
    // Agent hazard attacks go through the same global all-attacks modifiers as
    // creature attacks (Chill Them with Fear le-106), so Rank upon Rank's
    // "non-agent" wording is an explicit opt-out. Elerína (dm-7) is a Man agent
    // with prowess 5; revealed and away from home she gets no rule-3.iv.6.1
    // modifier, so the attack must stay at 5 prowess / 1 strike.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [], cardsInPlay: [rankInPlay] },
      ],
    });
    const agent = makeAgent(ELERINA, { revealed: true });
    const state = withAgentInPlay(
      { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
      HAZARD_PLAYER,
      { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
    );

    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.strikesTotal).toBe(1);
  });

  // ── Cannot be duplicated ───────────────────────────────────────────────────

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RANK_UPON_RANK], siteDeck: [MINAS_TIRITH], cardsInPlay: [rankInPlay] },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
