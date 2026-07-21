/**
 * @module wh-46.test
 *
 * Card test: Open to the Summons (wh-46)
 * Type: minion-resource-event (permanent, ringwraith alignment)
 *
 * Card text:
 *   "Playable on a company. One agent character may be played with target
 *    company at a Darkhaven [{DH}] or in your starting company — place this card
 *    with the agent. -1 to his mind to a minimum of 1. This card may be played
 *    with a starting company in lieu of a minor item. When played as such,
 *    reveal it when starting companies are determined as if it were a character.
 *    Does not allow you to start with a character that says he cannot be in the
 *    starting company. Cannot be duplicated on a given character. Cannot be
 *    included in a Balrog's deck."
 *
 * CRF 22 rulings: "Allows minions / Fallen-wizards to play an Agent as a
 * starting character"; "Does not allow you to start with a character that says
 * he cannot be in the starting company."
 *
 * Implemented as an **agent-summons recruitment vehicle** (`recruitment-vehicle`
 * with `agentRecruit: true`) modelled on Thrall of the Voice (wh-82):
 *  - In-play (rules 1–3): a Ringwraith or Fallen-wizard holding the card may
 *    summon one agent into a company **at a Darkhaven** — `playCharacterActions`
 *    emits a `play-character` carrying `viaRecruitmentInstanceId`, with the
 *    influence cost reduced by the agent's `-1` mind. `handlePlayCharacter`
 *    places the card with the agent (attaches it, removed from hand) and the
 *    play consumes the one-character-per-turn slot. `recomputeDerived` then
 *    reduces the agent's mind by one (floor 1). Only offered at Darkhavens —
 *    never at other sites, and never for a Wizard/Balrog player.
 *  - Setup (rules 4–5): the card is a `starting-item` carrying
 *    `starting-company-placement`. It is brought in the draft pool "in lieu of a
 *    minor item" and must be **drafted** as any other card in an earlier round
 *    (CoE 1.9.R2) — a Ringwraith may draft this one Stage resource. Each drafted
 *    copy lifts the Ringwraith/Fallen-wizard agent draft-gate (rules 1.41/1.42)
 *    for ONE agent, so an agent may then be drafted as a starting character; at
 *    finalize the copy is placed with that agent, reducing its mind.
 *  - "Does not allow you to start with a character that says he cannot be in the
 *    starting company" — enforced by the existing `not-starting-character`
 *    draft rule (an agent flagged so is never draftable).
 *  - "Cannot be duplicated on a given character" — the `duplication-limit`
 *    (scope `character`) declares it; structurally each agent instance is played
 *    once and receives at most one vehicle, so two copies can never land on the
 *    same character.
 *  - "Cannot be included in a Balrog's deck" — enforced by deck validation
 *    (wh-46 is on the Balrog banned list); not a runtime effect.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Summon one agent with a company at a Darkhaven, via the card  | OK     |
 * | 2 | Place this card with the agent (attach it, consume turn slot) | OK     |
 * | 3 | -1 to the agent's mind, to a minimum of 1                     | OK     |
 * | 4 | May start with the agent in your starting company (gate lift) | OK     |
 * | 5 | Drafted "in lieu of a minor item", placed with the agent      | OK     |
 * | 6 | Only a Ringwraith/Fallen-wizard, only at a Darkhaven          | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, getCharacter,
  recomputeDerived, dispatch, createGame, draftInstId, runActions, makePlayDeck, pool,
  Phase, Alignment, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, GameConfig } from '../../index.js';

const OPEN_TO_THE_SUMMONS = 'wh-46' as CardDefinitionId;
const BILL_FERNY = 'dm-3' as CardDefinitionId;      // minion agent, mind 3 (→ 2); home Bree/Cameth Brin
const IVIC = 'dm-17' as CardDefinitionId;           // minion agent, mind 6 (→ 5)
const ORC_TRACKER = 'le-34' as CardDefinitionId;    // minion character (not an agent), mind 3
const ORC_BRAWLER = 'le-30' as CardDefinitionId;    // minion character (not an agent), mind 1
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // Ringwraith Darkhaven [{DH}]
const AMON_HEN = 'tw-371' as CardDefinitionId;      // Ruins & Lairs — a non-Darkhaven site
const OPPONENT_CHAR = 'tw-155' as CardDefinitionId; // Gamling the Old — hero opponent filler

/**
 * Build a Ringwraith organization-phase state whose company sits at `site`,
 * holding a minion filler character, with `hand` in the Ringwraith's hand.
 */
function rwOrgState(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [ORC_TRACKER] }], hand, siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

/** play-character actions for `charDef` that carry the recruitment vehicle. */
function summonPlays(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId
      && (a.action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId !== undefined,
  );
}

/** any viable play-character action for `charDef`. */
function anyPlay(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId,
  );
}

describe('Open to the Summons (wh-46)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: summon an agent with a company at a Darkhaven ───────────────────

  test('without the card, a Ringwraith cannot play an agent at a Darkhaven that is not its home site', () => {
    // Bill Ferny homes at Bree/Cameth Brin; agents played as characters are
    // home-site-only, so at Minas Morgul (a Darkhaven, not his home) with no
    // enabler he has no legal play.
    expect(anyPlay(rwOrgState(MINAS_MORGUL, [BILL_FERNY]), BILL_FERNY)).toHaveLength(0);
  });

  test('with the card in hand, the agent may be summoned at a Darkhaven via the vehicle', () => {
    const state = rwOrgState(MINAS_MORGUL, [BILL_FERNY, OPEN_TO_THE_SUMMONS]);
    const cardId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === OPEN_TO_THE_SUMMONS)!.instanceId;
    const plays = summonPlays(state, BILL_FERNY);
    expect(plays.length).toBeGreaterThan(0);
    expect((plays[0].action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId).toBe(cardId);
  });

  // ── Rule 6: only a Ringwraith/Fallen-wizard, only at a Darkhaven ────────────

  test('the summon is NOT offered when no Darkhaven is available', () => {
    // Company sits at Amon Hen (a Ruins & Lairs) and the site deck holds only a
    // non-Darkhaven site (Moria). With no Darkhaven anywhere, the agent — which
    // is otherwise home-site-only — has no legal play even holding the card.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: AMON_HEN, characters: [ORC_TRACKER] }], hand: [BILL_FERNY, OPEN_TO_THE_SUMMONS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(summonPlays(state, BILL_FERNY)).toHaveLength(0);
    expect(anyPlay(state, BILL_FERNY)).toHaveLength(0);
  });

  test('a Wizard player holding the card cannot summon an agent (agents are hazards for Wizards)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: [OPPONENT_CHAR] }], hand: [BILL_FERNY, OPEN_TO_THE_SUMMONS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [ORC_TRACKER] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    expect(anyPlay(state, BILL_FERNY)).toHaveLength(0);
  });

  // ── Rules 2 + 3: place the card with the agent; -1 to his mind ──────────────

  test('summoning places the card with the agent, reduces its mind, and consumes the turn slot', () => {
    const state = rwOrgState(MINAS_MORGUL, [BILL_FERNY, OPEN_TO_THE_SUMMONS]);
    const cardId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === OPEN_TO_THE_SUMMONS)!.instanceId;
    const play = summonPlays(state, BILL_FERNY)[0];

    const after = recomputeDerived(dispatch(state, play.action));

    // Bill Ferny is in play with the card placed on him, removed from hand.
    const ferny = getCharacter(after, RESOURCE_PLAYER, BILL_FERNY);
    expect(ferny).toBeDefined();
    expect(ferny.items.some(i => i.definitionId === OPEN_TO_THE_SUMMONS)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);

    // -1 to his mind (3 → 2).
    expect(ferny.effectiveStats.mind).toBe(2);

    // Counts against the one-character-per-turn limit.
    expect((after.phaseState as { characterPlayedThisTurn?: boolean }).characterPlayedThisTurn).toBe(true);
  });

  test('a higher-mind agent is reduced by one when summoned (Ivic, mind 6 → 5)', () => {
    const state = rwOrgState(MINAS_MORGUL, [IVIC, OPEN_TO_THE_SUMMONS]);
    const play = summonPlays(state, IVIC)[0];
    expect(play).toBeDefined();
    const after = recomputeDerived(dispatch(state, play.action));
    expect(getCharacter(after, RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBe(5);
  });

  // ── Rules 4 + 5: agent as a starting character via the drafted enabler ──────

  /**
   * Ringwraith draft config: `draftPool` holds the agent + a minion filler +
   * any `poolExtras` — the enabler is brought in the pool "in lieu of a minor
   * item" (CoE 1.9.R2), never the play deck. The opponent is a Wizard with a
   * single character so the draft rounds resolve cleanly.
   */
  function rwDraftConfig(poolExtras: CardDefinitionId[]): GameConfig {
    return {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Ringwraith,
          draftPool: [BILL_FERNY, ORC_BRAWLER, ...poolExtras], playDeck: makePlayDeck(), siteDeck: [MINAS_MORGUL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
  }

  function agentDraftPicks(state: GameState) {
    const agentId = draftInstId(state, RESOURCE_PLAYER, BILL_FERNY);
    return computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'draft-pick'
        && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === agentId,
    );
  }

  test('without any enabler, a Ringwraith cannot draft the agent as a starting character', () => {
    const state = createGame(rwDraftConfig([]), pool);
    expect(agentDraftPicks(state)).toHaveLength(0);
  });

  test('the enabler must be drafted first — merely sitting in the pool does not lift the gate', () => {
    // Reproduces game mruf9v4i-hhj3y4 (seq 1): Open to the Summons sat in the
    // draft pool (a minor-item substitute), alongside the agents. Per CoE 1.9.R2
    // it must be drafted "as any other card in an earlier round" before an agent
    // may be drafted — a copy still undrafted in the pool does not lift the gate.
    let state = createGame(rwDraftConfig([OPEN_TO_THE_SUMMONS]), pool);
    // Undrafted, the enabler does not yet lift the gate.
    expect(agentDraftPicks(state)).toHaveLength(0);
    // A Ringwraith may draft the enabler "in lieu of a minor item"; the opponent
    // takes their only pick and the round resolves.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, OPEN_TO_THE_SUMMONS) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    // Now the enabler is drafted → the agent may be drafted, and the reducer
    // accepts the pick.
    expect(agentDraftPicks(state).length).toBeGreaterThan(0);
    const agentId = draftInstId(state, RESOURCE_PLAYER, BILL_FERNY);
    expect(reduce(state, { type: 'draft-pick', player: PLAYER_1, characterInstanceId: agentId }).error).toBeUndefined();
  });

  test('the reducer accepts the agent draft only while a drafted enabler is held', () => {
    // With the enabler drafted, the agent pick is accepted.
    let withEnabler = createGame(rwDraftConfig([OPEN_TO_THE_SUMMONS]), pool);
    withEnabler = runActions(withEnabler, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(withEnabler, RESOURCE_PLAYER, OPEN_TO_THE_SUMMONS) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(withEnabler, 1, OPPONENT_CHAR) },
    ]);
    const okId = draftInstId(withEnabler, RESOURCE_PLAYER, BILL_FERNY);
    expect(reduce(withEnabler, { type: 'draft-pick', player: PLAYER_1, characterInstanceId: okId }).error).toBeUndefined();

    // With no enabler anywhere, the agent pick is rejected.
    const noEnabler = createGame(rwDraftConfig([]), pool);
    const blockedId = draftInstId(noEnabler, RESOURCE_PLAYER, BILL_FERNY);
    expect(reduce(noEnabler, { type: 'draft-pick', player: PLAYER_1, characterInstanceId: blockedId }).error).toBeDefined();
  });

  test('a second agent may not be drafted with only one enabler drafted', () => {
    // draftPool holds two agents + one enabler; a single drafted enabler lifts
    // the gate for only one agent.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Ringwraith,
          draftPool: [BILL_FERNY, IVIC, OPEN_TO_THE_SUMMONS], playDeck: makePlayDeck(), siteDeck: [MINAS_MORGUL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // Round 1: draft the enabler; opponent takes their only pick (auto-stops).
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, OPEN_TO_THE_SUMMONS) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    // Round 2: draft the first agent (allowed by the one enabler).
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BILL_FERNY) },
    ]);
    // The second agent is now gated: only one enabler was drafted.
    const secondAgentId = draftInstId(state, RESOURCE_PLAYER, IVIC);
    const picks = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'draft-pick'
        && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === secondAgentId,
    );
    expect(picks).toHaveLength(0);
  });

  test('a drafted enabler is placed with the agent at finalize, reducing its mind (3 → 2)', () => {
    // draftPool holds just the agent + the enabler so the draft finalises as soon
    // as both are drafted.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.Ringwraith,
          draftPool: [BILL_FERNY, OPEN_TO_THE_SUMMONS], playDeck: makePlayDeck(), siteDeck: [MINAS_MORGUL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // Round 1: draft the enabler; opponent takes their only character (emptying
    // their pool and auto-stopping).
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, OPEN_TO_THE_SUMMONS) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    // Round 2: draft the agent; the Ringwraith's pool is now empty so the draft
    // auto-finalises.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BILL_FERNY) },
    ]);

    // At finalize the drafted enabler is placed with the agent (a
    // recruitment-vehicle Stage resource prefers an agent), reducing its mind 3 → 2.
    const after = recomputeDerived(state);
    const ferny = getCharacter(after, RESOURCE_PLAYER, BILL_FERNY);
    expect(ferny.items.some(i => i.definitionId === OPEN_TO_THE_SUMMONS)).toBe(true);
    expect(ferny.effectiveStats.mind).toBe(2);
  });
});
