/**
 * @module wh-63.test
 *
 * Card test: Bad Company (wh-63)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), 2 stage points
 *
 * Printed text:
 *   "You may play Orc and Troll characters and include them in your starting
 *    company. You cannot start with a character that says he cannot be in the
 *    starting company. Cannot be duplicated by a given player."
 *
 * CERTIFIED. Every printed rule is exercised through the engine:
 *   1. `stage-points` (2) — contributes 2 stage points to its Fallen-wizard
 *      controller while in play.
 *   2. `allow-character-play` (filter: race ∈ {orc, troll}) — lifts the
 *      Fallen-wizard Orc/Troll play restriction (CoE 2.II.2.2.F2) during the
 *      organization phase, for the controller only.
 *   3. "…and include them in your starting company" — the card carries the
 *      `starting-item` keyword, so it is drafted from the pool as a Stage
 *      resource (CoE 1.9.F4) and, once drafted, lifts the Orc/Troll *draft* gate
 *      (rule 1.43 / CoE 1.9.F2) in both the legal-action layer and the reducer.
 *      At draft finalize it is put into play (CoE 1.9.F4), so the permission and
 *      its stage points carry into turn 1.
 *   4. "You cannot start with a character that says he cannot be in the starting
 *      company" — a character with the `not-starting-character` play-flag
 *      (Wûluag as-6) stays undraftable even with Bad Company drafted.
 *   5. `duplication-limit` (scope `player`, max 1) — a second copy is neither
 *      playable from hand while one is in play nor draftable alongside the first.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardOrgPhaseState,
  addCardInPlay, recomputeDerived, viableActions,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  createGame, draftInstId, runActions, makePlayDeck, pool, dispatchResult,
  RIVENDELL,
} from '../test-helpers.js';
import { computeLegalActions, Alignment, reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameConfig, GameState } from '../../index.js';

const BAD_COMPANY = 'wh-63' as CardDefinitionId;      // Stage permanent-event, 2 stage points
const SARUMAN_FW = 'wh-9' as CardDefinitionId;        // Fallen-wizard avatar
const ISENGARD_FW = 'wh-56' as CardDefinitionId;      // Fallen-wizard Wizardhaven
const ORC_BRAWLER = 'le-30' as CardDefinitionId;      // Orc, mind 1, non-unique
const TROLL_LOUT = 'le-44' as CardDefinitionId;       // Troll, mind 3, non-unique
const WULUAG = 'as-6' as CardDefinitionId;            // Troll, mind 4 — `not-starting-character`
const BALIN = 'tw-123' as CardDefinitionId;           // hero character, mind 5 (freely draftable by a FW)
const ARAGORN = 'tw-120' as CardDefinitionId;         // the opponent's lone draft-pool character

/** A Fallen-wizard draft config: P1's pool is `fwPool`, P2 is a Wizard with Aragorn. */
function draftConfig(fwPool: CardDefinitionId[]): GameConfig {
  return {
    players: [
      { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
        draftPool: fwPool, playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
        draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
    ],
    seed: 42,
  };
}

/** Whether `defId` is offered as a viable draft pick to the Fallen-wizard (P1). */
function draftOffered(state: GameState, defId: CardDefinitionId): boolean {
  const inst = draftInstId(state, RESOURCE_PLAYER, defId);
  return computeLegalActions(state, PLAYER_1).some(
    ea => ea.viable && ea.action.type === 'draft-pick'
      && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === inst,
  );
}

describe('Bad Company (wh-63) — in play', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: stage points ───────────────────────────────────────────────────

  test('contributes 2 stage points to its Fallen-wizard controller', () => {
    let state = buildFallenWizardOrgPhaseState({ site: ISENGARD_FW, characters: [SARUMAN_FW] });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);

    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, BAD_COMPANY));
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ─── Rule 2: "You may play Orc and Troll characters" ────────────────────────

  test('a Fallen-wizard cannot play an Orc character with no enabling Stage resource in play', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_FW, characters: [SARUMAN_FW], hand: [ORC_BRAWLER],
    });
    const orcId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.characterInstanceId === orcId)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1).find(a => a.characterInstanceId === orcId)).toBeDefined();

    const blocked = computeLegalActions(state, PLAYER_1).find(
      ea => !ea.viable && ea.action.type === 'play-character'
        && (ea.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === orcId,
    );
    expect(blocked?.reason ?? '').toContain('Bad Company');
  });

  test('with Bad Company in play, an Orc character becomes playable', () => {
    let state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_FW, characters: [SARUMAN_FW], hand: [ORC_BRAWLER],
    });
    const orcId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, BAD_COMPANY));

    expect(viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === orcId).length).toBeGreaterThan(0);
  });

  test('with Bad Company in play, a Troll character becomes playable', () => {
    let state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_FW, characters: [SARUMAN_FW], hand: [TROLL_LOUT],
    });
    const trollId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.characterInstanceId === trollId)).toHaveLength(0);

    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, BAD_COMPANY));
    expect(viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === trollId).length).toBeGreaterThan(0);
  });

  test('the permission is the controller\'s own — an opponent\'s Bad Company does not lift the gate', () => {
    let state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_FW, characters: [SARUMAN_FW], hand: [ORC_BRAWLER],
    });
    const orcId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    state = recomputeDerived(addCardInPlay(state, HAZARD_PLAYER, BAD_COMPANY));

    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.characterInstanceId === orcId)).toHaveLength(0);
  });

  // ─── Rule 5: cannot be duplicated by a given player ─────────────────────────

  test('a second Bad Company cannot be played while the first is in play', () => {
    let state = buildFallenWizardOrgPhaseState({
      site: ISENGARD_FW, characters: [SARUMAN_FW], hand: [BAD_COMPANY],
    });
    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    // With no copy in play, the second one in hand is playable.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === handId)).toHaveLength(1);

    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, BAD_COMPANY));
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === handId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1).find(
      ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === handId,
    );
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('cannot be duplicated by a given player');
  });
});

describe('Bad Company (wh-63) — starting company (character draft)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 3: "…and include them in your starting company" ───────────────────

  test('a Fallen-wizard cannot draft an Orc or Troll before drafting Bad Company', () => {
    const state = createGame(draftConfig([BAD_COMPANY, ORC_BRAWLER, TROLL_LOUT]), pool);

    expect(draftOffered(state, BAD_COMPANY)).toBe(true);
    expect(draftOffered(state, ORC_BRAWLER)).toBe(false);
    expect(draftOffered(state, TROLL_LOUT)).toBe(false);

    // The reducer is the authority: submitting the pick anyway is rejected.
    const rejected = reduce(state, {
      type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, ORC_BRAWLER),
    });
    expect(rejected.error).toContain('Orc or Troll');
  });

  test('once Bad Company is drafted, Orc and Troll characters become draftable', () => {
    let state = createGame(draftConfig([BAD_COMPANY, ORC_BRAWLER, TROLL_LOUT, BALIN]), pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BAD_COMPANY) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, HAZARD_PLAYER, ARAGORN) },
    ]);

    expect(draftOffered(state, ORC_BRAWLER)).toBe(true);
    expect(draftOffered(state, TROLL_LOUT)).toBe(true);

    // And the pick is accepted by the reducer.
    const accepted = dispatchResult(state, {
      type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, ORC_BRAWLER),
    });
    expect(accepted.error).toBeUndefined();
  });

  test('a drafted Bad Company is put into play with the starting company, Orc included', () => {
    let state = createGame(draftConfig([BAD_COMPANY, ORC_BRAWLER]), pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BAD_COMPANY) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, HAZARD_PLAYER, ARAGORN) },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, ORC_BRAWLER) },
    ]);

    // CoE 1.9.F4: the drafted Stage resource is put into play, not held in hand…
    const fw = state.players[RESOURCE_PLAYER];
    expect(fw.cardsInPlay.some(c => c.definitionId === BAD_COMPANY)).toBe(true);
    expect(fw.hand.some(c => c.definitionId === BAD_COMPANY)).toBe(false);
    // …so its stage points count from turn 1…
    expect(fw.stagePoints).toBe(2);
    // …and the Orc it admitted is in the starting company.
    const orc = Object.values(fw.characters).find(c => c.definitionId === ORC_BRAWLER);
    expect(orc).toBeDefined();
    expect(fw.companies[0].characters).toContain(orc!.instanceId);
  });

  // ─── Rule 4: "cannot start with a character that says he cannot" ────────────

  test('a character that cannot be in a starting company stays undraftable even with Bad Company', () => {
    let state = createGame(draftConfig([BAD_COMPANY, WULUAG, BALIN]), pool);
    expect(draftOffered(state, WULUAG)).toBe(false);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BAD_COMPANY) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, HAZARD_PLAYER, ARAGORN) },
    ]);

    // Bad Company lifts the Orc/Troll gate but not the starting-company ban.
    expect(draftOffered(state, WULUAG)).toBe(false);
    const rejected = reduce(state, {
      type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, WULUAG),
    });
    expect(rejected.error).toContain('may not be one of the starting characters');
  });

  // ─── Rule 5: cannot be duplicated by a given player ─────────────────────────

  test('a Fallen-wizard cannot draft a second Bad Company', () => {
    let state = createGame(draftConfig([BAD_COMPANY, BAD_COMPANY, BALIN]), pool);
    const firstCopy = draftInstId(state, RESOURCE_PLAYER, BAD_COMPANY);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: firstCopy },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, HAZARD_PLAYER, ARAGORN) },
    ]);

    // The second copy is still in the pool, but no longer offered.
    expect(draftOffered(state, BAD_COMPANY)).toBe(false);

    const rejected = reduce(state, {
      type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, RESOURCE_PLAYER, BAD_COMPANY),
    });
    expect(rejected.error).toContain('cannot be duplicated by a given player');
  });
});
