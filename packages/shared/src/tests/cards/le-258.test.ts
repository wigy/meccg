/**
 * @module le-258.test
 *
 * Card test: Words of Menace and Deceit (le-258)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Spirit-magic.
 *
 * Card text:
 *   "Magic. Spirit-magic. Playable on a spirit-magic-using character. +5 to
 *    the character's direct influence for the rest of the turn. Unless he is a
 *    Ringwraith, he makes a corruption check modified by -4. Cannot be
 *    duplicated on a given character."
 *
 * Distinct rules:
 *   1. Play-target — a `play-target` (character) with filter
 *      `target.skills $includes "spirit-magic"`. Only a character who uses
 *      spirit-magic (natively or via a granted skill) is a legal target; a
 *      Ringwraith *without* spirit-magic (e.g. Dwar — sorcery) is NOT eligible.
 *   2. Main effect — a turn-scoped `character-stat-modifier` constraint added on
 *      play (`on-event self-enters-play` → `add-constraint character-stat-modifier
 *      direct-influence +5`) targeting the chosen character. The effect resolver
 *      synthesises the +5 into that character's effective direct influence for
 *      the rest of the turn.
 *   3. Corruption check — a second `on-event self-enters-play` →
 *      `enqueue-corruption-check modifier -4`, gated `when $not target.race
 *      ringwraith`, so a Ringwraith target makes no check while a non-Ringwraith
 *      target makes a -4 corruption check.
 *   4. "Cannot be duplicated on a given character" — a `duplication-limit`
 *      (scope character, max 1). The rest-of-turn +5 leaves a character-targeted
 *      active constraint marked with this definition; a second copy is unplayable
 *      on that same character while the constraint lives, but remains playable on
 *      a different spirit-magic character.
 *
 * Rule coverage:
 * | # | Rule                                                                   | Status      |
 * |---|------------------------------------------------------------------------|-------------|
 * | 1 | Playable on a Ringwraith spirit-magic user (Adûnaphel)                  | IMPLEMENTED |
 * | 2 | NOT playable on a Ringwraith without spirit-magic (Dwar — sorcery)      | IMPLEMENTED |
 * | 3 | Playing it adds a turn-scoped +5 direct-influence character-stat-modifier | IMPLEMENTED |
 * | 4 | The target's effective direct influence rises by exactly +5 on play     | IMPLEMENTED |
 * | 5 | Playing it discards the event to the discard pile                       | IMPLEMENTED |
 * | 6 | Ringwraith target makes NO corruption check                             | IMPLEMENTED |
 * | 7 | Non-Ringwraith target makes a corruption check modified by -4           | IMPLEMENTED |
 * | 8 | Cannot be duplicated on the same character; still playable on another    | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   WORDS (le-258)       - minion short event (this card)
 *   ADUNAPHEL (le-50)    - ringwraith avatar, spirit-magic user (base DI 4)
 *   UVATHA (le-57)       - ringwraith, spirit-magic user (base DI 5)
 *   DWAR (le-52)         - ringwraith WITHOUT spirit-magic (sorcery) — ineligible
 *   GORBAG (le-11)       - orc (non-ringwraith), used to exercise the -4 check
 *   VARIAG_CAMP (le-411) - minion border-hold (site of origin)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  viableActions, findHandCardId, expectInDiscardPile, getCharacter,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';
import { Alignment } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const WORDS = 'le-258' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const UVATHA = 'le-57' as CardDefinitionId;
const DWAR = 'le-52' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** All viable le-258 play actions targeting a specific character instance. */
function wordsActionsForTarget(state: GameState, targetId: CardInstanceId): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.targetCharacterId === targetId);
}

/** Org-phase state for the ringwraith player with the given company + hand. */
function orgState(opts: {
  characters: CardDefinitionId[];
  hand: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: opts.characters }],
        hand: opts.hand,
        playDeck: [MINAS_TIRITH],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

describe('Words of Menace and Deceit (le-258)', () => {
  beforeEach(() => resetMint());

  // ── Play-target: spirit-magic character only ─────────────────────────────

  test('playable on a Ringwraith spirit-magic user (Adûnaphel)', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [WORDS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    expect(wordsActionsForTarget(state, adunId)).toHaveLength(1);
  });

  test('NOT playable on a Ringwraith without spirit-magic (Dwar — sorcery)', () => {
    const state = orgState({ characters: [DWAR], hand: [WORDS] });
    // No eligible spirit-magic target → no viable play-short-event action.
    const anyPlay = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, WORDS));
    expect(anyPlay).toHaveLength(0);
  });

  // ── Main effect: +5 direct influence for the rest of the turn ────────────

  test('playing it adds a turn-scoped +5 direct-influence character-stat-modifier on the target and discards the card', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [WORDS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WORDS);

    const after = dispatch(state, wordsActionsForTarget(state, adunId)[0]);

    const mods = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.target.kind === 'character',
    );
    expect(mods).toHaveLength(1);
    const constraint = mods[0];
    expect(constraint.scope.kind).toBe('turn');
    if (constraint.kind.type === 'character-stat-modifier') {
      expect(constraint.kind.stat).toBe('direct-influence');
      expect(constraint.kind.value).toBe(5);
      expect(constraint.kind.characterId).toBe(adunId);
    }
    expect(constraint.sourceDefinitionId).toBe(WORDS);

    expectInDiscardPile(after, RESOURCE_PLAYER, inst);
  });

  test('the target character’s effective direct influence rises by exactly +5 on play', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [WORDS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    const before = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).effectiveStats.directInfluence;

    const after = dispatch(state, wordsActionsForTarget(state, adunId)[0]);
    const afterDI = getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).effectiveStats.directInfluence;
    expect(afterDI).toBe(before + 5);
  });

  // ── Corruption check: unless the target is a Ringwraith ──────────────────

  test('no corruption check is enqueued for a Ringwraith target (Adûnaphel)', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [WORDS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;

    const after = dispatch(state, wordsActionsForTarget(state, adunId)[0]);
    const ccResolutions = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccResolutions).toHaveLength(0);
  });

  test('a corruption check modified by -4 is enqueued for a non-Ringwraith target', () => {
    // Non-Ringwraith spirit-magic users arise via granted skills in real play;
    // the corruption-check `when` gate keys purely on race, so we drive the
    // reducer directly against a non-Ringwraith minion (Gorbag) to exercise
    // the "Unless he is a Ringwraith" branch and the -4 modifier.
    const state = orgState({ characters: [GORBAG], hand: [WORDS] });
    const gorbagId = getCharacter(state, RESOURCE_PLAYER, GORBAG).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WORDS);

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: inst,
      targetCharacterId: gorbagId,
    };
    const after = dispatch(state, action);

    const ccResolutions = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccResolutions).toHaveLength(1);
    const cc = ccResolutions[0].kind as { modifier?: number };
    expect(cc.modifier).toBe(-4);
  });

  // ── Cannot be duplicated on a given character ────────────────────────────

  test('a second copy cannot target the same character, but is still playable on another spirit-magic character', () => {
    const state = orgState({ characters: [ADUNAPHEL, UVATHA], hand: [WORDS, WORDS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    const uvathaId = getCharacter(state, RESOURCE_PLAYER, UVATHA).instanceId;

    // Before any play: both characters are eligible targets.
    expect(wordsActionsForTarget(state, adunId).length).toBeGreaterThan(0);
    expect(wordsActionsForTarget(state, uvathaId).length).toBeGreaterThan(0);

    // Play one copy on Adûnaphel.
    const after = dispatch(state, wordsActionsForTarget(state, adunId)[0]);

    // The surviving copy can no longer target Adûnaphel...
    expect(wordsActionsForTarget(after, adunId)).toHaveLength(0);
    // ...but Ûvatha (a different spirit-magic character) is still a legal target.
    expect(wordsActionsForTarget(after, uvathaId).length).toBeGreaterThan(0);

    // Sanity: legal actions still compute cleanly after the first play.
    expect(computeLegalActions(after, PLAYER_1).length).toBeGreaterThan(0);
  });
});
