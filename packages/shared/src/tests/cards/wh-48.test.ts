/**
 * @module wh-48.test
 *
 * Card test: Poison of his Voice (wh-48)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Spirit-magic.
 *
 * Card text:
 *   "Magic. Spirit-magic. Playable on a hazard permanent-event on a character
 *    in a spirit-magic-using character's company. Discard target hazard.
 *    Alternatively, playable on a spirit-magic-using Fallen-wizard. -6 to his
 *    stage points (to a minimum of 3) for the rest of the turn. Unless the
 *    spirit-magic-user is a Ringwraith, he makes a corruption check modified
 *    by -3."
 *
 * Effects:
 *   1. `play-target` character, filter `target.skills $includes spirit-magic`
 *      — the spirit-magic user (the caster) for both modes.
 *   2. Discard mode — a single-target `move` in-play → discard with
 *      `targetScope: "play-target-company"`: one play action per (caster ×
 *      hazard permanent-event attached to a character in the caster's
 *      company). Rides the chain; on resolution the hazard goes to its owner's
 *      discard pile and the caster makes the `corruptionCheck` (-3). A
 *      Ringwraith caster is exempt (rule 7.4, matching "Unless ... a
 *      Ringwraith").
 *   3. Stage mode — a `play-option` gated on `target.race: fallen-wizard`
 *      adding a turn-scoped `stage-points-modifier` constraint (-6, floor 3)
 *      on the Fallen-wizard, folded into the player's stage-point total.
 *   4. `on-event self-enters-play` → `enqueue-corruption-check` -3 unless the
 *      target is a Ringwraith — the stage mode's corruption check.
 *
 * Rule coverage:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Discard offered for a hazard perm-event on any character in the caster's company (caster included) | IMPLEMENTED |
 * | 2 | Not offered for hazards in another company or free-standing in play     | IMPLEMENTED |
 * | 3 | Not playable without a spirit-magic user                                | IMPLEMENTED |
 * | 4 | Discard resolves via chain: hazard → owner's discard, event → discard   | IMPLEMENTED |
 * | 5 | Non-Ringwraith caster makes a corruption check modified by -3           | IMPLEMENTED |
 * | 6 | Ringwraith caster makes no corruption check                             | IMPLEMENTED |
 * | 7 | Stage mode offered only on a Fallen-wizard                              | IMPLEMENTED |
 * | 8 | Stage mode: -6 stage points for the rest of the turn                    | IMPLEMENTED |
 * | 9 | Stage mode: to a minimum of 3 (never raises a total below 3)            | IMPLEMENTED |
 * |10 | Stage mode: Fallen-wizard makes a corruption check modified by -3       | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  FOOLISH_WORDS, LURE_OF_THE_SENSES, DOORS_OF_NIGHT, MORIA,
  attachHazardToChar, addCardInPlay, recomputeDerived, resetMint,
  viableShortEventPlays, buildAlignedOrgState, findHandCardId, findCharInstanceId,
  dispatch, resolveChain, expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Alignment } from '../../index.js';
import { sweepExpired } from '../../engine/pending.js';

const POISON = 'wh-48' as CardDefinitionId;

// Referenced only in this test file, so declared locally.
const ADUNAPHEL = 'le-50' as CardDefinitionId;  // Ringwraith, spirit-magic
const BELEGORN = 'le-2' as CardDefinitionId;    // Dúnadan, spirit-magic
const GORBAG = 'le-11' as CardDefinitionId;     // Orc, no spirit-magic
const DWAR = 'le-52' as CardDefinitionId;       // Ringwraith, sorcery only
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

const GANDALF_FW = 'wh-4' as CardDefinitionId;  // Fallen-wizard, spirit-magic
const ISENGARD_WH = 'wh-56' as CardDefinitionId;
const PLOTTING_RUIN = 'wh-79' as CardDefinitionId;  // 3 SP
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId; // 4 SP
const OROMES_WARDERS = 'wh-94' as CardDefinitionId; // 3 SP
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId; // 2 SP

describe('Poison of his Voice (wh-48)', () => {
  beforeEach(() => resetMint());

  // ─── Discard mode: targets ─────────────────────────────────────────────────

  test('discard offered for hazard permanent-events on any character in the caster’s company, caster included', () => {
    let state = buildAlignedOrgState({ alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL, GORBAG] }], hand: [POISON], siteDeck: [MORIA_MINION] });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GORBAG, FOOLISH_WORDS, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, ADUNAPHEL, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const adunId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    const gorbagHaz = state.players[RESOURCE_PLAYER].characters[findCharInstanceId(state, RESOURCE_PLAYER, GORBAG)].hazards[0].instanceId;
    const adunHaz = state.players[RESOURCE_PLAYER].characters[adunId].hazards[0].instanceId;

    const discards = viableShortEventPlays(state, PLAYER_1).filter(a => a.discardTargetInstanceId);
    expect(discards.map(a => a.discardTargetInstanceId).sort()).toEqual([gorbagHaz, adunHaz].sort());
    for (const a of discards) expect(a.targetScoutInstanceId).toBe(adunId);
    // Adûnaphel is not a Fallen-wizard — no stage-point mode.
    expect(viableShortEventPlays(state, PLAYER_1).filter(a => a.optionId)).toHaveLength(0);
  });

  test('hazards in another company, and free-standing hazard events, are not targetable', () => {
    let state = buildAlignedOrgState({
      alignment: Alignment.Ringwraith,
      companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL] }, { site: MINAS_MORGUL, characters: [GORBAG] }],
      hand: [POISON],
      siteDeck: [MORIA_MINION],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GORBAG, FOOLISH_WORDS, HAZARD_PLAYER);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);

    expect(viableShortEventPlays(state, PLAYER_1)).toHaveLength(0);
  });

  test('not playable without a spirit-magic user in the hazard’s company', () => {
    let state = buildAlignedOrgState({ alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR, GORBAG] }], hand: [POISON], siteDeck: [MORIA_MINION] });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GORBAG, FOOLISH_WORDS, HAZARD_PLAYER);

    expect(viableShortEventPlays(state, PLAYER_1)).toHaveLength(0);
  });

  // ─── Discard mode: resolution ──────────────────────────────────────────────

  test('discard resolves on the chain; non-Ringwraith caster makes a corruption check modified by -3', () => {
    let state = buildAlignedOrgState({ alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BELEGORN, GORBAG] }], hand: [POISON], siteDeck: [MORIA_MINION] });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GORBAG, FOOLISH_WORDS, HAZARD_PLAYER);
    const belegornId = findCharInstanceId(state, RESOURCE_PLAYER, BELEGORN);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const hazId = state.players[RESOURCE_PLAYER].characters[gorbagId].hazards[0].instanceId;
    const poisonId = findHandCardId(state, RESOURCE_PLAYER, POISON);

    const play = viableShortEventPlays(state, PLAYER_1).find(a => a.discardTargetInstanceId === hazId)!;
    expect(play.targetScoutInstanceId).toBe(belegornId);

    const onChain = dispatch(state, play);
    // Declared, not yet resolved: the hazard is still attached.
    expect(onChain.chain).not.toBeNull();
    expect(onChain.players[RESOURCE_PLAYER].characters[gorbagId].hazards).toHaveLength(1);

    const next = resolveChain(onChain);
    expect(next.players[RESOURCE_PLAYER].characters[gorbagId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, hazId);
    expectInDiscardPile(next, RESOURCE_PLAYER, poisonId);
    // The caster is not tapped by the play.
    expect(next.players[RESOURCE_PLAYER].characters[belegornId].status).toBe(state.players[RESOURCE_PLAYER].characters[belegornId].status);

    const ccs = next.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccs).toHaveLength(1);
    if (ccs[0].kind.type === 'corruption-check') {
      expect(ccs[0].kind.characterId).toBe(belegornId);
      expect(ccs[0].kind.modifier).toBe(-3);
    }
  });

  test('Ringwraith caster makes no corruption check', () => {
    let state = buildAlignedOrgState({ alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ADUNAPHEL, GORBAG] }], hand: [POISON], siteDeck: [MORIA_MINION] });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GORBAG, FOOLISH_WORDS, HAZARD_PLAYER);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const hazId = state.players[RESOURCE_PLAYER].characters[gorbagId].hazards[0].instanceId;

    const next = resolveChain(dispatch(state, viableShortEventPlays(state, PLAYER_1).find(a => a.discardTargetInstanceId === hazId)!));
    expectInDiscardPile(next, HAZARD_PLAYER, hazId);
    expect(next.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Stage mode ────────────────────────────────────────────────────────────

  test('stage mode is offered on a spirit-magic-using Fallen-wizard', () => {
    const state = buildAlignedOrgState({
      alignment: Alignment.FallenWizard,
      companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }],
      hand: [POISON],
      siteDeck: [MORIA],
      stageCards: [SHAMEFUL_DEEDS, PLOTTING_RUIN, OROMES_WARDERS],
    });
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const opts = viableShortEventPlays(state, PLAYER_1).filter(a => a.optionId === 'reduce-stage-points');
    expect(opts).toHaveLength(1);
    expect(opts[0].targetCharacterId).toBe(gandalfId);
  });

  test('stage mode: -6 stage points for the rest of the turn, and a -3 corruption check', () => {
    const state = buildAlignedOrgState({
      alignment: Alignment.FallenWizard,
      companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }],
      hand: [POISON],
      siteDeck: [MORIA],
      stageCards: [SHAMEFUL_DEEDS, PLOTTING_RUIN, OROMES_WARDERS],
    });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(10);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const poisonId = findHandCardId(state, RESOURCE_PLAYER, POISON);

    const after = dispatch(state, viableShortEventPlays(state, PLAYER_1).find(a => a.optionId === 'reduce-stage-points')!);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(4);
    expectInDiscardPile(after, RESOURCE_PLAYER, poisonId);

    const ccs = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccs).toHaveLength(1);
    if (ccs[0].kind.type === 'corruption-check') {
      expect(ccs[0].kind.characterId).toBe(gandalfId);
      expect(ccs[0].kind.modifier).toBe(-3);
    }

    // The reduction expires at the end of the turn.
    const nextTurn = recomputeDerived(sweepExpired(after, { kind: 'turn-end' }));
    expect(nextTurn.players[RESOURCE_PLAYER].stagePoints).toBe(10);
  });

  test('stage mode: reduced to a minimum of 3', () => {
    const state = buildAlignedOrgState({
      alignment: Alignment.FallenWizard,
      companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }],
      hand: [POISON],
      siteDeck: [MORIA],
      stageCards: [SHAMEFUL_DEEDS, PLOTTING_RUIN],
    });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(7);
    const after = dispatch(state, viableShortEventPlays(state, PLAYER_1).find(a => a.optionId === 'reduce-stage-points')!);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('stage mode: never raises a total already below 3', () => {
    const state = buildAlignedOrgState({
      alignment: Alignment.FallenWizard,
      companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }],
      hand: [POISON],
      siteDeck: [MORIA],
      stageCards: [A_MERRIER_WORLD],
    });
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    const after = dispatch(state, viableShortEventPlays(state, PLAYER_1).find(a => a.optionId === 'reduce-stage-points')!);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });
});
