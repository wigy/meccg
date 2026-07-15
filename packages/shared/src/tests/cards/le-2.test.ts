/**
 * @module le-2.test
 *
 * Card test: Belegorn (le-2)
 * Type: minion-character, alignment ringwraith, unique.
 * Stats: prowess 3, body 7, mind 5, direct influence 2, 2 MP.
 * Skills: Sage, Diplomat (printed) + spirit-magic (granted by text).
 * Race: Dúnadan. Homesite: Carn Dûm.
 *
 * Card text (authoritative — data/cards.json LE-2):
 *   "Unique. Can use spirit-magic."
 *
 * Distinct rules:
 *   1. "Unique." — `unique: true`. Only one copy per deck; handled generically
 *      by deck validation (not re-tested per-card).
 *   2. "Can use spirit-magic." — Belegorn is a legal caster/target for
 *      spirit-magic magic resource cards. The codebase encodes a granted magic
 *      ability by adding the magic class to the character's `skills` array
 *      (precedent: le-50, le-54, le-57, le-58, wh-4, wh-7, dm-7, dm-14). The
 *      engine gates spirit-magic spells with a play-target filter
 *      `target.skills $includes "spirit-magic"`, so adding the skill is what
 *      actually makes the card castable on him.
 *
 * These tests exercise rule 2 through a real spirit-magic spell,
 * "Words of Menace and Deceit" (le-258, "Playable on a spirit-magic-using
 * character"):
 *   - le-258 IS a legal play targeting Belegorn (he uses spirit-magic).
 *   - le-258 is NOT a legal play targeting Dwar (le-52 — a Ringwraith who uses
 *     sorcery, not spirit-magic), proving the skill — not race or company — is
 *     the gate.
 *   - Playing le-258 on Belegorn resolves: he is a valid spirit-magic target,
 *     and being a non-Ringwraith Dúnadan he makes the spell's corruption check.
 *
 * Playable: YES
 *
 * Fixtures:
 *   BELEGORN (le-2)      - this card (spirit-magic user, Dúnadan)
 *   WORDS (le-258)       - minion spirit-magic short event
 *   DWAR (le-52)         - Ringwraith WITHOUT spirit-magic (sorcery) — control
 *   VARIAG_CAMP (le-411) - minion border-hold (site of origin)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  viableActions, findHandCardId, getCharacter,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';
import { Alignment } from '../../index.js';

const BELEGORN = 'le-2' as CardDefinitionId;
const WORDS = 'le-258' as CardDefinitionId;
const DWAR = 'le-52' as CardDefinitionId;
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

describe('Belegorn (le-2)', () => {
  beforeEach(() => resetMint());

  test('a spirit-magic spell (Words of Menace) is playable on Belegorn — he can use spirit-magic', () => {
    const state = orgState({ characters: [BELEGORN], hand: [WORDS] });
    const belegornId = getCharacter(state, RESOURCE_PLAYER, BELEGORN).instanceId;
    expect(wordsActionsForTarget(state, belegornId)).toHaveLength(1);
  });

  test('the same spirit-magic spell is NOT playable on a non-spirit-magic Ringwraith (Dwar — sorcery), so the gate is the skill, not race or company', () => {
    // Both in one company: only Belegorn (spirit-magic) is a legal target.
    const state = orgState({ characters: [BELEGORN, DWAR], hand: [WORDS] });
    const belegornId = getCharacter(state, RESOURCE_PLAYER, BELEGORN).instanceId;
    const dwarId = getCharacter(state, RESOURCE_PLAYER, DWAR).instanceId;

    expect(wordsActionsForTarget(state, belegornId).length).toBeGreaterThan(0);
    expect(wordsActionsForTarget(state, dwarId)).toHaveLength(0);
  });

  test('playing the spirit-magic spell on Belegorn resolves; as a non-Ringwraith Dúnadan he makes the corruption check', () => {
    const state = orgState({ characters: [BELEGORN], hand: [WORDS] });
    const belegornId = getCharacter(state, RESOURCE_PLAYER, BELEGORN).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WORDS);

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: inst,
      targetCharacterId: belegornId,
    };
    const after = dispatch(state, action);

    // Words grants a turn-scoped +5 direct-influence modifier to the target,
    // confirming Belegorn was accepted as a spirit-magic target.
    const mods = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier'
        && c.kind.characterId === belegornId
        && c.sourceDefinitionId === WORDS,
    );
    expect(mods).toHaveLength(1);

    // Belegorn is not a Ringwraith, so the spell's -4 corruption check fires.
    const ccResolutions = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccResolutions).toHaveLength(1);
    expect((ccResolutions[0].kind as { modifier?: number }).modifier).toBe(-4);
  });
});
