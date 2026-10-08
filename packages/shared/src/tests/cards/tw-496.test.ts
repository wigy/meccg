/**
 * @module tw-496.test
 *
 * Card test: The Iron Crown (tw-496)
 * Type: hero-resource-item (greater), unique. MP 4, CP 5.
 *
 * Card text: "Unique. Whenever bearer makes an influence check, he must also
 * make a corruption check. If the bearer is not a Hobbit: he receives +1 to
 * body to a maximum of 10; he receives +4 to direct influence; and he may tap
 * The Iron Crown to cancel an attack by Orcs, Trolls, or Men against his
 * company."
 *
 * Effects:
 * 1. `on-event: bearer-makes-influence-check` → `enqueue-corruption-check` —
 *    fired by `fireBearerInfluenceCheckTriggers` (reducer-site.ts) after a
 *    faction influence roll or an opponent-influence resolution by the bearer,
 *    whether the check succeeds or fails. Not Hobbit-gated.
 * 2. `stat-modifier` body +1, max 10, when `bearer.race $ne hobbit`. The
 *    printed `bodyModifier` is 0 so the bonus is not applied to a Hobbit.
 * 3. `stat-modifier` direct-influence +4, when `bearer.race $ne hobbit`.
 * 4. `cancel-attack` cost `{ tap: "self" }`, when bearer is not a Hobbit and
 *    `enemy.race $in [orc, troll, man]`.
 *
 * Rule coverage:
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Successful faction influence check → corruption check        | IMPLEMENTED |
 * | 2 | Failed faction influence check → corruption check            | IMPLEMENTED |
 * | 3 | Opponent-influence check (success and failure) → check       | IMPLEMENTED |
 * | 4 | Hobbit bearer still makes the corruption check               | IMPLEMENTED |
 * | 5 | Non-Hobbit: +1 body to a maximum of 10                       | IMPLEMENTED |
 * | 6 | Non-Hobbit: +4 direct influence                              | IMPLEMENTED |
 * | 7 | Hobbit bearer gets no body / DI bonus                        | IMPLEMENTED |
 * | 8 | Tap to cancel an Orc, Troll or Man attack                    | IMPLEMENTED |
 * | 9 | Not vs other races; not when tapped; not for a Hobbit bearer | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, dispatch, viableActions, attachItemToChar, setItemStatus,
  findCharInstanceId, getCharacter, recomputeDerived, makeCancelWindowCombat,
  ARAGORN, LEGOLAS, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { FRODO, GALADRIEL } from '../../card-ids.js';
import { Race } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, CorruptionCheckAction, GameState } from '../../index.js';
import type { OpponentInfluenceAttempt } from '../../types/pending.js';
import { resolveInfluenceAttemptRoll, resolveOpponentInfluenceDefend } from '../../engine/reducer-site.js';

const IRON_CROWN = 'tw-496' as CardDefinitionId;
const HOBBITS = 'tw-258' as CardDefinitionId;        // hero faction, influence# 9
const DWALIN = 'tw-142' as CardDefinitionId;         // dwarf, body 7
const ORC_PATROL = 'tw-074' as CardDefinitionId;     // orc
const BERT = 'tw-016' as CardDefinitionId;           // troll
const ASSASSIN = 'tw-8' as CardDefinitionId;         // man
const WARGS = 'tw-109' as CardDefinitionId;          // wolf
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;     // dragon

describe('The Iron Crown (tw-496)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1, 2, 4: faction influence check forces a corruption check ─────

  test('successful faction influence check by the bearer: corruption check on the bearer', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN], hand: [HOBBITS] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, IRON_CROWN));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(HOBBITS);

    const pending = result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(aragornId);
      expect(pending[0].kind.modifier).toBe(0);
      expect(pending[0].kind.reason).toContain('The Iron Crown');
    }

    // The check is a real one: Aragorn bears 5 CP (the Crown), need 6.
    const checks = viableActions(result.state, PLAYER_1, 'corruption-check');
    expect(checks).toHaveLength(1);
    expect((checks[0].action as CorruptionCheckAction).need).toBe(6);
    const passed = dispatch({ ...result.state, cheatRollTotal: 9 }, checks[0].action);
    expect(passed.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(passed.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('failed faction influence check by the bearer still forces the corruption check', () => {
    // Dwalin: DI 0 + 4 (Crown); 2 + 4 = 6 < influence# 9 → the check fails.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [DWALIN], hand: [HOBBITS] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, DWALIN, IRON_CROWN));
    const dwalinId = findCharInstanceId(state, RESOURCE_PLAYER, DWALIN);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 2 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: dwalinId } },
    );
    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(HOBBITS);

    const pending = result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(dwalinId);
    }
  });

  test('a Hobbit bearer also makes the corruption check (first sentence is not race-gated)', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [FRODO], hand: [HOBBITS] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, IRON_CROWN));
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: frodoId } },
    );
    const pending = result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(frodoId);
    }
  });

  test('an influence check by a character not bearing the Crown forces no corruption check', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN, FRODO], hand: [HOBBITS] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, IRON_CROWN));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const factionCard = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOBBITS)!;

    const result = resolveInfluenceAttemptRoll(
      { ...state, cheatRollTotal: 12 },
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );
    expect(result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Rule 3: opponent-influence checks ────────────────────────────────────

  test('opponent-influence check by the bearer (success and failure) forces a corruption check', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] });
    const state: GameState = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, IRON_CROWN));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    const attempt: OpponentInfluenceAttempt = {
      influencerId: aragornId,
      targetInstanceId: legolasId,
      targetKind: 'character',
      targetPlayer: PLAYER_2,
      attackerRoll: 12,
      influencerDI: 7,
      opponentGI: 0,
      targetMind: 1,
      controllerDI: 0,
      crossAlignmentPenalty: 0,
      revealedCard: null,
    };

    // Success: 12 + 7 - 0 - 2 - 0 = 17 > 1.
    const success = resolveOpponentInfluenceDefend({ ...state, cheatRollTotal: 2 }, attempt);
    expect(success.state.players[HAZARD_PLAYER].characters[legolasId]).toBeUndefined();
    const successChecks = success.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(successChecks).toHaveLength(1);
    expect(successChecks[0].actor).toBe(PLAYER_1);
    if (successChecks[0].kind.type === 'corruption-check') {
      expect(successChecks[0].kind.characterId).toBe(aragornId);
    }

    // Failure: 2 + 7 - 0 - 12 - 0 = -3 <= 1.
    const failure = resolveOpponentInfluenceDefend({ ...state, cheatRollTotal: 12 }, { ...attempt, attackerRoll: 2 });
    expect(failure.state.players[HAZARD_PLAYER].characters[legolasId]).toBeDefined();
    const failureChecks = failure.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(failureChecks).toHaveLength(1);
    if (failureChecks[0].kind.type === 'corruption-check') {
      expect(failureChecks[0].kind.characterId).toBe(aragornId);
    }
  });

  // ─── Rules 5–7: non-Hobbit +1 body (max 10) and +4 direct influence ───────

  test('non-Hobbit bearers: +1 body to a maximum of 10, +4 direct influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN, DWALIN, GALADRIEL] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const withDwalin = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, DWALIN, IRON_CROWN));
    const dwalin = getCharacter(withDwalin, RESOURCE_PLAYER, DWALIN).effectiveStats;
    expect(dwalin.body).toBe(8);               // 7 + 1
    expect(dwalin.directInfluence).toBe(4);    // 0 + 4

    const withAragorn = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, IRON_CROWN));
    const aragorn = getCharacter(withAragorn, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(aragorn.body).toBe(10);             // 9 + 1
    expect(aragorn.directInfluence).toBe(7);   // 3 + 4

    const withGaladriel = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GALADRIEL, IRON_CROWN));
    expect(getCharacter(withGaladriel, RESOURCE_PLAYER, GALADRIEL).effectiveStats.body).toBe(10); // 10 + 1 → capped
  });

  test('a Hobbit bearer gets no body or direct-influence bonus', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, IRON_CROWN));
    const frodo = getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats;
    expect(frodo.body).toBe(9);
    expect(frodo.directInfluence).toBe(1);
  });

  // ─── Rules 8–9: tap to cancel an Orc, Troll or Man attack ─────────────────

  test('non-Hobbit bearer may tap the Crown to cancel Orc, Troll and Man attacks only', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCrown = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, IRON_CROWN);
    const aragornId = findCharInstanceId(withCrown, RESOURCE_PLAYER, ARAGORN);
    const crownId = withCrown.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === IRON_CROWN)!.instanceId;

    for (const [creatureDefId, creatureRace] of [[ORC_PATROL, Race.Orc], [BERT, Race.Troll], [ASSASSIN, Race.Man]] as const) {
      const combat = makeCancelWindowCombat(withCrown, { creatureDefId, creatureRace, strikesTotal: 1 });
      const actions = viableActions(combat, PLAYER_1, 'cancel-attack');
      expect(actions).toHaveLength(1);
      expect((actions[0].action as CancelAttackAction).cardInstanceId).toBe(crownId);
    }
    for (const [creatureDefId, creatureRace] of [[WARGS, Race.Wolf], [CAVE_DRAKE, Race.Dragon]] as const) {
      const combat = makeCancelWindowCombat(withCrown, { creatureDefId, creatureRace, strikesTotal: 1 });
      expect(viableActions(combat, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    }

    // Activating cancels the attack and taps the Crown, not the bearer.
    const orcCombat = makeCancelWindowCombat(withCrown, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, strikesTotal: 1 });
    const [cancel] = viableActions(orcCombat, PLAYER_1, 'cancel-attack');
    const after = dispatch(orcCombat, cancel.action);
    expect(after.combat).toBeNull();
    const aragornAfter = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragornAfter.items.find(i => i.instanceId === crownId)!.status).toBe(CardStatus.Tapped);
    expect(aragornAfter.status).toBe(CardStatus.Untapped);

    // An already-tapped Crown cannot cancel.
    const tapped = setItemStatus(orcCombat, RESOURCE_PLAYER, ARAGORN, IRON_CROWN, CardStatus.Tapped);
    expect(viableActions(tapped, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('a Hobbit bearer may not tap the Crown to cancel an attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCrown = attachItemToChar(base, RESOURCE_PLAYER, FRODO, IRON_CROWN);
    const combat = makeCancelWindowCombat(withCrown, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, strikesTotal: 1 });
    expect(viableActions(combat, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
