/**
 * @module td-103.test
 *
 * Card test: Burglary (td-103)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text: "Burglary attempt. Tap a character to make a burglary attempt at a
 *   site in lieu of facing its automatic-attacks. Tap the site and make a
 *   roll modified by +2 if the character is a scout and by +3 if he is a
 *   Hobbit. If the result is greater than 10, an item normally playable at
 *   the site may be played with the character. If the attempt fails, the
 *   character must face all automatic-attacks alone."
 *
 * Effects:
 * | # | Effect Type      | Status | Notes                                            |
 * |---|------------------|--------|---------------------------------------------------|
 * | 1 | burglary-attempt | OK     | roll (2d6 + scout/hobbit bonuses) in lieu of      |
 * |   |                  |        | facing automatic-attacks; success skips them and  |
 * |   |                  |        | unlocks an item play; failure means facing them   |
 * |   |                  |        | alone with no combat support                      |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, FRODO, LEGOLAS,
  MORIA, RIVENDELL,
  DAGGER_OF_WESTERNESSE,
  buildSitePhaseTwoPlayer, resetMint,
  setupAutoAttackStep, makeSitePhase,
  dispatch, viableActions, phaseStateAs,
  findCharInstanceId, findHandCardId,
} from '../test-helpers.js';
import { computeLegalActions, reduce } from '../../index.js';
import { CardStatus } from '../../types/common.js';
import type { CardDefinitionId, CardInstanceId, SitePhaseState } from '../../index.js';

const BURGLARY = 'td-103' as CardDefinitionId;

describe('Burglary (td-103)', () => {
  beforeEach(() => resetMint());

  // ── Offering declare-burglary ─────────────────────────────────────────────

  test('offered for the untapped character in a company facing automatic-attacks with Burglary in hand', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);

    const offered = viableActions(state, PLAYER_1, 'declare-burglary');
    expect(offered).toHaveLength(1);
    expect((offered[0].action as { characterInstanceId: unknown }).characterInstanceId).toBe(aragornId);
  });

  test('one action offered per untapped character in the company', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN, LEGOLAS], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });

    expect(viableActions(state, PLAYER_1, 'declare-burglary')).toHaveLength(2);
  });

  test('NOT offered without Burglary in hand', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });

    expect(viableActions(state, PLAYER_1, 'declare-burglary')).toHaveLength(0);
  });

  test('NOT offered at a site with no automatic-attacks', () => {
    const base = buildSitePhaseTwoPlayer({ site: RIVENDELL, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });

    expect(viableActions(state, PLAYER_1, 'declare-burglary')).toHaveLength(0);
  });

  test('NOT offered once an attack this slot has already been faced', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const stepped = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const state = { ...stepped, phaseState: { ...phaseStateAs<SitePhaseState>(stepped), automaticAttacksResolved: 1 } };

    expect(viableActions(state, PLAYER_1, 'declare-burglary')).toHaveLength(0);
  });

  test('NOT offered for an already-tapped character', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const tapped = {
      ...state,
      players: [
        { ...state.players[0], characters: { ...state.players[0].characters, [aragornId]: { ...state.players[0].characters[aragornId], status: CardStatus.Tapped } } },
        state.players[1],
      ] as typeof state.players,
    };

    expect(viableActions(tapped, PLAYER_1, 'declare-burglary')).toHaveLength(0);
  });

  // ── Declaration: taps character + site, discards card, enqueues the roll ─

  test('declaring taps the character and the site, discards the card, and queues a burglary-attempt resolution', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const card = findHandCardId(state, 0, BURGLARY);

    const after = dispatch(state, { type: 'declare-burglary', player: PLAYER_1, cardInstanceId: card, characterInstanceId: aragornId });

    expect(after.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(after.players[0].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(after.players[0].hand.find(c => c.instanceId === card)).toBeUndefined();
    expect(after.players[0].discardPile.some(c => c.instanceId === card)).toBe(true);

    const pending = after.pendingResolutions.find(r => r.kind.type === 'burglary-attempt');
    expect(pending).toBeDefined();
    expect(computeLegalActions(after, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'burglary-attempt')).toHaveLength(1);
  });

  // ── Roll need values: scout / Hobbit bonuses ──────────────────────────────

  function declareAndGetRollAction(state: ReturnType<typeof setupAutoAttackStep>, charDefId: CardDefinitionId) {
    const charId = findCharInstanceId(state, 0, charDefId);
    const card = findHandCardId(state, 0, BURGLARY);
    const after = dispatch(state, { type: 'declare-burglary', player: PLAYER_1, cardInstanceId: card, characterInstanceId: charId });
    const rollAction = computeLegalActions(after, PLAYER_1).find(ea => ea.viable && ea.action.type === 'burglary-attempt')!;
    return { after, charId, rollAction };
  }

  test('need value for a scout who is not a Hobbit (Aragorn): threshold 10 - 2 + 1 = 9', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const { rollAction } = declareAndGetRollAction(state, ARAGORN);
    expect((rollAction.action as { need: number }).need).toBe(9);
  });

  test('need value for a Hobbit scout (Frodo): threshold 10 - (2 + 3) + 1 = 6', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [FRODO], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const { rollAction } = declareAndGetRollAction(state, FRODO);
    expect((rollAction.action as { need: number }).need).toBe(6);
  });

  test('need value for neither a scout nor a Hobbit (Legolas): threshold 10 - 0 + 1 = 11', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [LEGOLAS], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const { rollAction } = declareAndGetRollAction(state, LEGOLAS);
    expect((rollAction.action as { need: number }).need).toBe(11);
  });

  // ── Failure: the character faces all automatic-attacks alone ─────────────

  test('failed roll: character must face the automatic-attack alone, no combat support from the rest of the company', () => {
    // Aragorn (+2 scout). Roll 6 -> total 8, not > 10 -> failure.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN, LEGOLAS], heroHand: [BURGLARY] });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const { after, charId: aragornId, rollAction } = declareAndGetRollAction(state, ARAGORN);

    const afterRoll = dispatch({ ...after, cheatRollTotal: 6 }, rollAction.action);
    expect(afterRoll.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(afterRoll).soloAutoAttackCharacterId).toBe(aragornId);
    expect(afterRoll.pendingResolutions).toHaveLength(0);

    // Passing now initiates the site's automatic-attack (Orcs, 4 strikes/7 prowess).
    const afterPass = dispatch(afterRoll, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat).not.toBeNull();
    expect(afterPass.combat!.soloDefenderInstanceId).toBe(aragornId);

    // Only Aragorn may be assigned a strike — Legolas provides no combat support.
    const assignActions = computeLegalActions(afterPass, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'assign-strike',
    );
    expect(assignActions.length).toBeGreaterThan(0);
    for (const ea of assignActions) {
      expect((ea.action as { characterId: unknown }).characterId).toBe(aragornId);
    }
    expect(assignActions.some(ea => (ea.action as { characterId: unknown }).characterId === legolasId)).toBe(false);
  });

  // ── Success: automatic-attacks skipped, item unlocked with the character ─

  test('successful roll: automatic-attacks skipped entirely, an item may be played with the (tapped) character', () => {
    // Aragorn (+2 scout). Roll 9 -> total 11, > 10 -> success.
    const base = buildSitePhaseTwoPlayer({
      site: MORIA, heroChars: [ARAGORN], heroHand: [BURGLARY, DAGGER_OF_WESTERNESSE],
    });
    const state = setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
    const { after, charId: aragornId, rollAction } = declareAndGetRollAction(state, ARAGORN);

    const afterRoll = dispatch({ ...after, cheatRollTotal: 9 }, rollAction.action);
    expect(afterRoll.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(afterRoll).autoAttacksSkipped).toBe(true);
    expect(phaseStateAs<SitePhaseState>(afterRoll).burglaryItemUnlock).toBe(aragornId);

    // No combat is ever faced — passing through automatic-attacks / declare-agent-attack
    // / resolve-attacks lands straight at play-resources.
    const afterAutoAttacks = dispatch(afterRoll, { type: 'pass', player: PLAYER_1 });
    expect(afterAutoAttacks.combat).toBeNull();
    expect(phaseStateAs<SitePhaseState>(afterAutoAttacks).step).toBe('declare-agent-attack');

    const afterAgentAttack = dispatch(afterAutoAttacks, { type: 'pass', player: PLAYER_1 });
    expect(phaseStateAs<SitePhaseState>(afterAgentAttack).step).toBe('resolve-attacks');

    const afterResolveAttacks = dispatch(afterAgentAttack, { type: 'pass', player: PLAYER_1 });
    expect(phaseStateAs<SitePhaseState>(afterResolveAttacks).step).toBe('play-resources');

    // Aragorn is tapped (from the burglary attempt) yet still eligible to receive
    // the item, bypassing the normal untapped-character requirement.
    expect(afterResolveAttacks.players[0].characters[aragornId].status).toBe(CardStatus.Tapped);
    const dagger = findHandCardId(afterResolveAttacks, 0, DAGGER_OF_WESTERNESSE);
    const itemActions = computeLegalActions(afterResolveAttacks, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === dagger,
    );
    const onAragorn = itemActions.find(ea => (ea.action as { attachToCharacterId: unknown }).attachToCharacterId === aragornId);
    expect(onAragorn).toBeDefined();

    const afterItem = reduce(afterResolveAttacks, onAragorn!.action).state;
    expect(afterItem.players[0].characters[aragornId].items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    // The allowance is one-shot: consumed after the item is played.
    expect(phaseStateAs<SitePhaseState>(afterItem).burglaryItemUnlock).toBeUndefined();
  });
});
