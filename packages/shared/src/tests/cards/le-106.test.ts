/**
 * @module le-106.test
 *
 * Card test: Chill Them with Fear (le-106)
 * Type: hazard-event (long)
 * Effects: 5
 *   1. duplication-limit scope: game max: 1 — "Cannot be duplicated"
 *   2. stat-modifier prowess +2, target all-attacks, gated on
 *      `enemy.race $in [elf, dwarf, dunadan, hobbit]`
 *   3. stat-modifier strikes +2, same gate
 *   4. stat-modifier prowess -1, same gate + `inPlay: "Doors of Night"`
 *   5. stat-modifier strikes -1, same gate + `inPlay: "Doors of Night"`
 *
 * Card text:
 *   "All Elf, Dwarf, Dúnadan, and Hobbit attacks receive +2 prowess and +2
 *    strikes (+1 prowess and +1 strike if Doors of Night is in play). Cannot be
 *    duplicated."
 *
 * The Doors of Night clause *reduces* the bonus, so it is modeled as the base
 * +2 plus a -1 softening gated on DoN (net +1) — the Sun Shone Fiercely (ba-25)
 * pattern.
 *
 * "All … attacks" covers all three kinds of attack, and this test exercises each:
 *   - site automatic-attacks — Iron Hill Dwarf-hold (le-383): Dwarves 4/10,
 *     Bag End (le-350): Hobbits 5/5, Grey Havens (as-149): Elves 3/8
 *   - hazard creatures — Sons of Kings (le-91): Dúnedain 3 strikes / 10 prowess
 *   - agent hazard attacks — Fori the Beardless (dm-11): Dwarf agent, prowess 4,
 *     one strike (Elerína dm-7, a Man agent, is the race negative control)
 * Dead Marshes (tw-384): Undead 2/8 is the race negative control for attacks.
 *
 * | # | Effect                                   | Status      | Notes                                        |
 * |---|------------------------------------------|-------------|----------------------------------------------|
 * | 1 | duplication-limit (game, max 1)          | IMPLEMENTED | reducer.ts duplicate-check                   |
 * | 2 | stat-modifier prowess +2 (4 races)       | IMPLEMENTED | target: all-attacks, enemy.race normalised   |
 * | 3 | stat-modifier strikes +2 (4 races)       | IMPLEMENTED | target: all-attacks                          |
 * | 4 | stat-modifier prowess -1 (DoN softening) | IMPLEMENTED | inPlay condition in buildAttackContext       |
 * | 5 | stat-modifier strikes -1 (DoN softening) | IMPLEMENTED | inPlay condition in buildAttackContext       |
 *
 * Playable: YES
 * Certified: 2026-07-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  CardStatus,
  DOORS_OF_NIGHT,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  makeMHState, makeBorderMHState, makeSitePhase,
  makeAgent, withAgentInPlay,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  dispatch, viableActions,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType } from '../../index.js';
import type {
  CardInPlay, CardInstanceId, CardDefinitionId, GameState, DeclareAgentAttackAction,
} from '../../index.js';

const CHILL_THEM_WITH_FEAR = 'le-106' as CardDefinitionId;

// Sites (all minion versions — the only printed Elf/Dwarf/Hobbit/Dúnadan attacks).
const IRON_HILL_DWARF_HOLD = 'le-383' as CardDefinitionId; // Free-hold — Dwarves 4 / 10
const BAG_END = 'le-350' as CardDefinitionId;              // Free-hold — Hobbits 5 / 5 (first attack)
const GREY_HAVENS = 'as-149' as CardDefinitionId;          // Free-hold — Elves 3 / 8 (first attack)
const DEAD_MARSHES = 'tw-384' as CardDefinitionId;         // Shadow-hold — Undead 2 / 8

const SONS_OF_KINGS = 'le-91' as CardDefinitionId;         // Dúnedain hazard creature, 3 strikes / 10 prowess
const MIONID = 'as-3' as CardDefinitionId;                 // minion character (defender for Sons of Kings)

const FORI = 'dm-11' as CardDefinitionId;                  // Dwarf agent, prowess 4, homesite Iron Hill Dwarf-hold
const ELERINA = 'dm-7' as CardDefinitionId;                // Man agent, prowess 5 — race negative control
const AGENT_SITE_ID = 'test-le106-agent-site' as CardInstanceId;

const chillInPlay: CardInPlay = {
  instanceId: 'chill-1' as CardInstanceId,
  definitionId: CHILL_THEM_WITH_FEAR,
  status: CardStatus.Untapped,
};

const doorsInPlay: CardInPlay = {
  instanceId: 'doors-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

/** Ringwraith company at Moria with the hazard player holding Sons of Kings. */
function minionDefenderState(hazardCardsInPlay: CardInPlay[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [MIONID] }],
        hand: [],
        siteDeck: [PELARGIR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [SONS_OF_KINGS],
        siteDeck: [RIVENDELL],
        cardsInPlay: hazardCardsInPlay,
      },
    ],
  });
  return { ...state, phaseState: makeBorderMHState() };
}

/** Hero company at Moria facing an agent of `agentDef` declared by the hazard player. */
function agentAttackState(agentDef: CardDefinitionId, hazardCardsInPlay: CardInPlay[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [], cardsInPlay: hazardCardsInPlay },
    ],
  });
  const agent = makeAgent(agentDef, { revealed: true });
  return withAgentInPlay(
    { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
    HAZARD_PLAYER,
    { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
  );
}

describe('Chill Them with Fear (le-106)', () => {
  beforeEach(() => resetMint());

  // ── Site automatic-attacks of the four named races ────────────────────────

  test('Dwarf automatic-attack: +2 prowess and +2 strikes (4/10 → 6/12)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [chillInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(6);
    expect(after.combat!.strikeProwess).toBe(12);
  });

  test('baseline: without Chill Them with Fear the Dwarf attack is unchanged (4/10)', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }));

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  test('Hobbit automatic-attack: +2 prowess and +2 strikes (5/5 → 7/7)', () => {
    // Bag End's first automatic-attack is Hobbits 5 strikes / 5 prowess.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BAG_END }), [chillInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(7);
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test('Elf automatic-attack: +2 prowess and +2 strikes (3/8 → 5/10)', () => {
    // Grey Havens' first automatic-attack is Elves 3 strikes / 8 prowess.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: GREY_HAVENS }), [chillInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(5);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  test('an attack of another race is untouched (Undead 2/8 stays 2/8)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DEAD_MARSHES }), [chillInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(8);
  });

  // ── Doors of Night halves the bonus to +1 / +1 ────────────────────────────

  test('with Doors of Night the Dwarf attack gets only +1/+1 (4/10 → 5/11)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [chillInPlay, doorsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(5);
    expect(after.combat!.strikeProwess).toBe(11);
  });

  test('Doors of Night alone (no Chill) leaves the Dwarf attack at 4/10', () => {
    // Proves the reduction is Chill's own softening clause, not a DoN effect.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD }), [doorsInPlay]),
    );

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(10);
  });

  // ── Hazard creature attacks (Dúnedain) ────────────────────────────────────

  test('Dúnadan hazard creature: +2 prowess and +2 strikes (3/10 → 5/12)', () => {
    const ready = minionDefenderState([chillInPlay]);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2,
      handCardId(ready, HAZARD_PLAYER),
      companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-type' as const, value: RegionType.Border },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(12);
  });

  test('Dúnadan hazard creature with Doors of Night: only +1/+1 (3/10 → 4/11)', () => {
    const ready = minionDefenderState([chillInPlay, doorsInPlay]);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2,
      handCardId(ready, HAZARD_PLAYER),
      companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-type' as const, value: RegionType.Border },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  test('baseline: the same creature attack is 3/10 without Chill Them with Fear', () => {
    const ready = minionDefenderState([]);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2,
      handCardId(ready, HAZARD_PLAYER),
      companyIdAt(ready, RESOURCE_PLAYER),
      { method: 'region-type' as const, value: RegionType.Border },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  // ── Agent hazard attacks (rule 2.V.iii) ───────────────────────────────────

  test('Dwarf agent attack: +2 prowess and +2 strikes (4 prowess / 1 strike → 6 / 3)', () => {
    // Fori the Beardless, revealed and away from his home site: no rule-3.iv.6.1
    // modifier, so the printed prowess 4 is the base the card modifies.
    const state = agentAttackState(FORI, [chillInPlay]);
    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(6);
    expect(after.combat!.strikesTotal).toBe(3);
  });

  test('baseline: the Dwarf agent attacks at 4 prowess / 1 strike without the card', () => {
    const state = agentAttackState(FORI, []);
    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(4);
    expect(after.combat!.strikesTotal).toBe(1);
  });

  test('with Doors of Night the Dwarf agent attack gets only +1/+1 (→ 5 / 2)', () => {
    const state = agentAttackState(FORI, [chillInPlay, doorsInPlay]);
    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.strikesTotal).toBe(2);
  });

  test('an agent of another race is untouched (Man agent stays 5 prowess / 1 strike)', () => {
    const state = agentAttackState(ELERINA, [chillInPlay]);
    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.strikesTotal).toBe(1);
  });

  // ── Cannot be duplicated ──────────────────────────────────────────────────

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CHILL_THEM_WITH_FEAR],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [chillInPlay],
        },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }),
    };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
