/**
 * @module tw-59.test
 *
 * Card test: Lure of Power (tw-59)
 * Type: hazard-event (permanent), non-unique, keywords: ["corruption"]
 * Effects: 1 (on-event successful-influence-attempt, when target.race $ne hobbit,
 *             apply sequence [enqueue-corruption-check modifier -4,
 *                             move self → discard])
 *
 * "The next non-Hobbit character to make a successful influence attempt
 *  (e. g., against a faction, an opponent's character, etc.) must immediately
 *  make a corruption check modified by -4. Discard this card after this
 *  corruption check."
 *
 * The card resolves as a bare permanent-event into its owner's `cardsInPlay`.
 * While there, the engine fires its trigger from BOTH influence-success seams:
 * the faction influence roll (`resolveInfluenceAttemptRoll`) and the
 * opponent-influence resolution (`resolveOpponentInfluenceDefend`) — matching
 * the card's own examples ("against a faction, an opponent's character").
 * A Hobbit influencer does not trigger it (the card waits for the NEXT
 * non-Hobbit), a failed attempt does not trigger it, and per the card's
 * official clarification duplicate copies in play produce only ONE corruption
 * check while ALL copies are discarded.
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Successful faction influence attempt → corruption check at -4      | IMPLEMENTED |
 * | 2 | The -4 flows into the corruption-check roll need                    | IMPLEMENTED |
 * | 3 | Card is discarded after triggering                                  | IMPLEMENTED |
 * | 4 | Successful opponent-influence attempt also triggers                 | IMPLEMENTED |
 * | 5 | Hobbit influencer: no check, card stays in play                     | IMPLEMENTED |
 * | 6 | Failed attempt: no check, card stays in play                        | IMPLEMENTED |
 * | 7 | Two copies in play: one check, both discarded (clarification)       | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (minion path, full chain): LAGDUF (le-18, orc, DI 0) at
 * GOBLIN_GATE (le-378) influencing GOBLINS_GOBLIN_GATE (le-265, inf# 9).
 * Fixtures (hero path, direct resolver): ARAGORN (dunadan) / FRODO (hobbit)
 * influencing HOBBITS (tw-258, inf# 9); LEGOLAS as the opponent-influence
 * target character.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, dispatch, viableActions,
  makeSitePhase, firstFactionInfluenceAttempt, addCardInPlay,
  findCharInstanceId,
  Phase, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MINAS_TIRITH, LORIEN,
} from '../test-helpers.js';
import { FRODO } from '../../card-ids.js';
import type {
  CardDefinitionId, GameState,
  FactionInfluenceRollAction, CorruptionCheckAction,
} from '../../index.js';
import type { OpponentInfluenceAttempt } from '../../types/pending.js';
import {
  resolveInfluenceAttemptRoll, resolveOpponentInfluenceDefend,
} from '../../engine/reducer-site.js';

const LURE_OF_POWER = 'tw-59' as CardDefinitionId;
const HOBBITS = 'tw-258' as CardDefinitionId;          // unique hero faction, influence# 9
const LAGDUF = 'le-18' as CardDefinitionId;            // orc character, DI 0
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9
const GOBLIN_GATE = 'le-378' as CardDefinitionId;      // shadow-hold, home of the faction
const CARN_DUM = 'le-359' as CardDefinitionId;         // minion haven

describe('Lure of Power (tw-59)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1+2+3: full chain — successful faction influence fires the check ──

  test('successful faction influence by a non-Hobbit: corruption check at -4, card discarded', () => {
    // Lagduf (orc, DI 0) at Goblin-gate influences Goblins of Goblin-gate
    // (inf# 9) while the opponent owns Lure of Power in play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withLure = addCardInPlay({ ...base, phaseState: makeSitePhase() }, HAZARD_PLAYER, LURE_OF_POWER);
    const lagdufId = findCharInstanceId(withLure, RESOURCE_PLAYER, LAGDUF);
    const factionInst = withLure.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(withLure, factionInst);
    expect(attempt).toBeDefined();

    // Declare the attempt, pass the chain to the paused faction-influence-roll.
    let cur = dispatch(withLure, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(9);

    // Force a raw 2d6 total of 12 → 12 >= 9 → the attempt succeeds.
    cur = dispatch({ ...cur, cheatRollTotal: 12 }, rollActions[0].action);
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(GOBLINS_GOBLIN_GATE);

    // Rule 1: a corruption check on the influencer is pending, modified by -4.
    const pending = cur.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(lagdufId);
      expect(pending[0].kind.modifier).toBe(-4);
      expect(pending[0].kind.reason).toContain('Lure of Power');
    }

    // Rule 3: Lure of Power left play, discarded to its owner's pile.
    expect(cur.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(LURE_OF_POWER);
    expect(cur.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(LURE_OF_POWER);

    // Rule 2: the pending check's roll need reflects the -4 (Lagduf CP 0:
    // need = 0 + 1 - (-4) = 5), and resolving with a raw roll of 9 passes
    // (9 - 4 = 5 > CP 0) leaving the character in play.
    const checkActions = viableActions(cur, PLAYER_1, 'corruption-check');
    expect(checkActions).toHaveLength(1);
    const checkAction = checkActions[0].action as CorruptionCheckAction;
    expect(checkAction.corruptionModifier).toBe(-4);
    expect(checkAction.need).toBe(5);
    const resolved = dispatch({ ...cur, cheatRollTotal: 9 }, checkAction);
    expect(resolved.players[RESOURCE_PLAYER].characters[lagdufId]).toBeDefined();
    expect(resolved.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Rule 6: a FAILED attempt does not trigger the card ─────────────────────

  test('failed faction influence attempt: no corruption check, card stays in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withLure = addCardInPlay({ ...base, phaseState: makeSitePhase() }, HAZARD_PLAYER, LURE_OF_POWER);
    const factionInst = withLure.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(withLure, factionInst);
    expect(attempt).toBeDefined();
    let cur = dispatch(withLure, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);

    // Raw total 3 → 3 < 9 → the attempt FAILS.
    cur = dispatch({ ...cur, cheatRollTotal: 3 }, rollActions[0].action);
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(GOBLINS_GOBLIN_GATE);

    expect(cur.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
    expect(cur.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(LURE_OF_POWER);
  });

  // ─── Rule 5: a Hobbit influencer does not trigger the card ──────────────────

  test('successful influence attempt by a Hobbit: no corruption check, card stays in play', () => {
    // Frodo (hobbit, DI 1) successfully influences the Hobbits faction
    // (12 + 1 >= 9) — the card waits for the NEXT non-Hobbit.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [HOBBITS] });
    const state = addCardInPlay(base, HAZARD_PLAYER, LURE_OF_POWER);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: frodoId } },
    );

    // The attempt itself succeeded…
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(HOBBITS);
    // …but the Hobbit does not satisfy the trigger's race gate.
    expect(result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(LURE_OF_POWER);
  });

  test('same setup with a non-Hobbit influencer DOES trigger (race gate isolation)', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN], hand: [HOBBITS] });
    const state = addCardInPlay(base, HAZARD_PLAYER, LURE_OF_POWER);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );

    const pending = result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(aragornId);
      expect(pending[0].kind.modifier).toBe(-4);
    }
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(LURE_OF_POWER);
    expect(result.state.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(LURE_OF_POWER);
  });

  // ─── Rule 4: opponent-influence success also triggers ("an opponent's character") ──

  test('successful opponent-influence attempt against a character triggers the check', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] });
    const state: GameState = addCardInPlay(base, HAZARD_PLAYER, LURE_OF_POWER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);

    // Snapshot as produced by the declare step: attacker rolled 12, target
    // mind 1, no defensive influence. Defender roll forced to 2 →
    // 12 + 3 - 0 - 2 - 0 = 13 > 1 → the attempt succeeds.
    const attempt: OpponentInfluenceAttempt = {
      influencerId: aragornId,
      targetInstanceId: legolasId,
      targetKind: 'character',
      targetPlayer: PLAYER_2,
      attackerRoll: 12,
      influencerDI: 3,
      opponentGI: 0,
      targetMind: 1,
      controllerDI: 0,
      crossAlignmentPenalty: 0,
      revealedCard: null,
    };
    const result = resolveOpponentInfluenceDefend({ ...state, cheatRollTotal: 2 }, attempt);

    // The influenced character was discarded away from the opponent…
    expect(result.state.players[HAZARD_PLAYER].characters[legolasId]).toBeUndefined();
    // …and the successful influence attempt fired Lure of Power.
    const pending = result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(aragornId);
      expect(pending[0].kind.modifier).toBe(-4);
      expect(pending[0].kind.reason).toContain('Lure of Power');
    }
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(LURE_OF_POWER);
    expect(result.state.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(LURE_OF_POWER);
  });

  test('failed opponent-influence attempt does not trigger', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] });
    const state: GameState = addCardInPlay(base, HAZARD_PLAYER, LURE_OF_POWER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);

    // Attacker rolled 2, defender roll forced to 12 → 2 + 3 - 0 - 12 - 0 = -7
    // <= mind 1 → the attempt fails.
    const attempt: OpponentInfluenceAttempt = {
      influencerId: aragornId,
      targetInstanceId: legolasId,
      targetKind: 'character',
      targetPlayer: PLAYER_2,
      attackerRoll: 2,
      influencerDI: 3,
      opponentGI: 0,
      targetMind: 1,
      controllerDI: 0,
      crossAlignmentPenalty: 0,
      revealedCard: null,
    };
    const result = resolveOpponentInfluenceDefend({ ...state, cheatRollTotal: 12 }, attempt);

    expect(result.state.players[HAZARD_PLAYER].characters[legolasId]).toBeDefined();
    expect(result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(LURE_OF_POWER);
  });

  // ─── Rule 7: duplicates — one check, ALL copies discarded ──────────────────

  test('two copies in play: only one corruption check, both copies discarded', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN], hand: [HOBBITS] });
    const withOne = addCardInPlay(base, HAZARD_PLAYER, LURE_OF_POWER);
    const state = addCardInPlay(withOne, HAZARD_PLAYER, LURE_OF_POWER);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );

    // One check only ("If 2 Lure of Power are in play, only one corruption
    // check is made and all Lure of Power are discarded").
    expect(result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(1);
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.filter(c => c.definitionId === LURE_OF_POWER)).toHaveLength(0);
    expect(result.state.players[HAZARD_PLAYER].discardPile.filter(c => c.definitionId === LURE_OF_POWER)).toHaveLength(2);
  });
});
