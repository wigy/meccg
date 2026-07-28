/**
 * @module tw-366.test
 *
 * Card test: Wizard's Voice (tw-366)
 * Type: hero-resource-event (short, keyword: spell, alignment: wizard),
 * non-unique, 0 MP.
 *
 * Card text:
 *   "Spell. Wizard only. +6 to direct influence for the Wizard for the rest of
 *    the turn. Wizard makes a corruption check modified by -3. Cannot be
 *    duplicated on a given turn."
 *
 * Distinct rules:
 *   1. Spell — `keywords: ["spell"]`, so cards keyed to spells (Wizard's Staff
 *      td-170: "+2 to any corruption check required by a spell") see it as the
 *      source of the check.
 *   2. Wizard only — a `play-target` (character) filtered on
 *      `target.race: "wizard"`. The Wizard is both the caster and the character
 *      the bonus and the corruption check land on.
 *   3. No phase restriction — the card carries no `play-window`, so CoE 2.1.1
 *      applies: the resource player may play it during any phase of his turn
 *      (exercised for the organization and site phases).
 *   4. +6 direct influence for the rest of the turn — `on-event
 *      self-enters-play` → `add-constraint character-stat-modifier
 *      direct-influence +6`, scope `turn`. The resolver folds it into the
 *      Wizard's `effectiveStats.directInfluence`, which is what `availableDI`
 *      spends on followers.
 *   5. Wizard makes a corruption check modified by -3 — a second `on-event
 *      self-enters-play` → `enqueue-corruption-check modifier -3` on the
 *      play-target.
 *   6. Cannot be duplicated on a given turn — a `duplication-limit`
 *      (scope turn, max 1). The rest-of-turn bonus leaves a turn-scoped active
 *      constraint sourced from this definition; while it lives, no second copy
 *      may be played at all — not even on a *different* Wizard (that is what
 *      separates a turn-scoped limit from le-258's character-scoped one).
 *
 * Rule coverage:
 * | # | Rule                                                                | Status      |
 * |---|---------------------------------------------------------------------|-------------|
 * | 1 | Playable in the organization phase, targeting the Wizard             | IMPLEMENTED |
 * | 2 | Only the Wizard is an eligible target (companions are not)           | IMPLEMENTED |
 * | 3 | NOT playable with no Wizard in play                                  | IMPLEMENTED |
 * | 4 | Also playable during the site phase (no play-window restriction)     | IMPLEMENTED |
 * | 5 | Play adds a turn-scoped +6 direct-influence constraint; card discarded| IMPLEMENTED |
 * | 6 | The Wizard's effective direct influence rises by exactly +6          | IMPLEMENTED |
 * | 7 | The +6 buys a follower the Wizard could not otherwise control        | IMPLEMENTED |
 * | 8 | The Wizard makes a corruption check modified by -3                   | IMPLEMENTED |
 * | 9 | The check counts as required by a spell (Wizard's Staff +2)          | IMPLEMENTED |
 * |10 | A second copy is unplayable this turn, even on another Wizard        | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixture alignment: hero (wizard) — hero characters and hero sites.
 *
 * Fixtures:
 *   PALLANDO (tw-175)     - Wizard, DI 10, no corruption modifiers of his own
 *   RADAGAST (tw-178)     - a second Wizard (turn-scope vs character-scope)
 *   BEORN (tw-126)        - mind 7, eats most of the Wizard's printed DI
 *   LEGOLAS (tw-168)      - mind 6, the follower the +6 pays for
 *   ARAGORN (tw-120)      - non-Wizard, ineligible target / opponent dummy
 *   WIZARDS_STAFF (td-170)- +2 to any corruption check required by a spell
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, findHandCardId, getCharacter, viableActions,
  attachItemToChar, dispatch, enqueueCorruptionCheck, expectInDiscardPile,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayShortEventAction, MoveToInfluenceAction, CorruptionCheckAction,
} from '../../index.js';

// ── Card under test ──────────────────────────────────────────────────────────
const WIZARDS_VOICE = 'tw-366' as CardDefinitionId;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PALLANDO = 'tw-175' as CardDefinitionId;      // Wizard, DI 10, no own corruption modifiers
const RADAGAST = 'tw-178' as CardDefinitionId;      // a second Wizard
const BEORN = 'tw-126' as CardDefinitionId;         // mind 7 — eats most of the Wizard's printed DI
const WIZARDS_STAFF = 'td-170' as CardDefinitionId; // +2 to spell corruption checks

/** Organization-phase state for the Wizard player with the given company + hand. */
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
        companies: [{ site: RIVENDELL, characters: opts.characters }],
        hand: opts.hand,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** All viable Wizard's Voice play actions, whatever their target. */
function voiceActions(state: GameState): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => state.players[RESOURCE_PLAYER].hand
      .some(c => c.instanceId === a.cardInstanceId && c.definitionId === WIZARDS_VOICE));
}

/** The viable move-to-influence action putting `charId` under `controllerId`, if any. */
function followAction(
  state: GameState,
  charId: CardInstanceId,
  controllerId: CardInstanceId,
): MoveToInfluenceAction | undefined {
  return viableActions(state, PLAYER_1, 'move-to-influence')
    .map(ea => ea.action as MoveToInfluenceAction)
    .find(a => a.characterInstanceId === charId && a.controlledBy === controllerId);
}

/** Play Wizard's Voice on the given Wizard and resolve the -3 corruption check. */
function playVoiceAndResolveCheck(state: GameState, wizardId: CardInstanceId): GameState {
  const play = voiceActions(state).find(a => a.targetCharacterId === wizardId);
  expect(play).toBeDefined();
  const afterPlay = dispatch(state, play!);

  const checks = viableActions(afterPlay, PLAYER_1, 'corruption-check');
  expect(checks).toHaveLength(1);
  // A 12 clears the need of 4 (CP 0 + 1 - (-3)) — the Wizard survives untouched.
  return dispatch({ ...afterPlay, cheatRollTotal: 12 }, checks[0].action);
}

describe("Wizard's Voice (tw-366)", () => {
  beforeEach(() => resetMint());

  // ── Rules 2-3: "Wizard only", playable in any phase of the turn ───────────

  test('playable in the organization phase, targeting the Wizard', () => {
    const state = orgState({ characters: [PALLANDO, ARAGORN], hand: [WIZARDS_VOICE] });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const plays = voiceActions(state);
    // Exactly one target: the Wizard. Aragorn (dúnadan) is not eligible.
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCharacterId).toBe(pallandoId);
    // No tap cost — nobody is offered as a tap target.
    expect(plays[0].targetScoutInstanceId).toBeFalsy();
  });

  test('NOT playable when no Wizard is in play', () => {
    const state = orgState({ characters: [ARAGORN, LEGOLAS], hand: [WIZARDS_VOICE] });
    expect(voiceActions(state)).toHaveLength(0);
  });

  test('also playable during the site phase — the card carries no phase restriction', () => {
    const state = buildSitePhaseState({
      characters: [PALLANDO],
      site: RIVENDELL,
      hand: [WIZARDS_VOICE],
    });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const plays = voiceActions(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCharacterId).toBe(pallandoId);
  });

  // ── Rule 4: +6 direct influence for the rest of the turn ──────────────────

  test('playing it adds a turn-scoped +6 direct-influence constraint on the Wizard and discards the card', () => {
    const state = orgState({ characters: [PALLANDO], hand: [WIZARDS_VOICE] });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const inst = findHandCardId(state, RESOURCE_PLAYER, WIZARDS_VOICE);

    const after = dispatch(state, voiceActions(state)[0]);

    const mods = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.target.kind === 'character',
    );
    expect(mods).toHaveLength(1);
    const constraint = mods[0];
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.sourceDefinitionId).toBe(WIZARDS_VOICE);
    if (constraint.kind.type === 'character-stat-modifier') {
      expect(constraint.kind.stat).toBe('direct-influence');
      expect(constraint.kind.value).toBe(6);
      expect(constraint.kind.characterId).toBe(pallandoId);
    }

    expectInDiscardPile(after, RESOURCE_PLAYER, inst);
  });

  test("the Wizard's effective direct influence rises by exactly +6", () => {
    const state = orgState({ characters: [PALLANDO], hand: [WIZARDS_VOICE] });
    const before = getCharacter(state, RESOURCE_PLAYER, PALLANDO).effectiveStats.directInfluence;

    const after = dispatch(state, voiceActions(state)[0]);
    const afterDI = getCharacter(after, RESOURCE_PLAYER, PALLANDO).effectiveStats.directInfluence;
    expect(afterDI).toBe(before + 6);
  });

  test('the +6 buys a follower the Wizard could not otherwise control', () => {
    // Pallando's printed DI is 10. Beorn (mind 7) leaves him 3 unused DI —
    // not enough for Legolas (mind 6). Wizard's Voice raises him to 16, so 9
    // remain and Legolas becomes controllable for the rest of the turn.
    const state = orgState({ characters: [PALLANDO, BEORN, LEGOLAS], hand: [WIZARDS_VOICE] });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const takeBeorn = followAction(state, beornId, pallandoId);
    expect(takeBeorn).toBeDefined();
    const loaded = dispatch(state, takeBeorn!);

    // 10 - 7 = 3 unused DI: Legolas (mind 6) is out of reach.
    expect(followAction(loaded, legolasId, pallandoId)).toBeUndefined();

    const afterVoice = playVoiceAndResolveCheck(loaded, pallandoId);

    // 16 - 7 = 9 unused DI: Legolas is now controllable...
    expect(followAction(afterVoice, legolasId, pallandoId)).toBeDefined();
    // ...and the move actually resolves, with Legolas ending up as a follower.
    const followed = dispatch(afterVoice, followAction(afterVoice, legolasId, pallandoId)!);
    expect(getCharacter(followed, RESOURCE_PLAYER, PALLANDO).followers).toContain(legolasId);
  });

  // ── Rule 5: "Wizard makes a corruption check modified by -3" ──────────────

  test('the Wizard makes a corruption check modified by -3', () => {
    const state = orgState({ characters: [PALLANDO, ARAGORN], hand: [WIZARDS_VOICE] });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const after = dispatch(state, voiceActions(state)[0]);

    const checks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    const cc = checks[0].kind;
    if (cc.type !== 'corruption-check') throw new Error('expected corruption-check');
    expect(cc.modifier).toBe(-3);
    // The Wizard makes it — not another character in his company.
    expect(cc.characterId).toBe(pallandoId);

    // Pallando carries no corruption points and no modifiers of his own:
    // need = CP(0) + 1 - modifier(-3) = 4.
    const offered = viableActions(after, PLAYER_1, 'corruption-check');
    expect(offered).toHaveLength(1);
    expect((offered[0].action as CorruptionCheckAction).need).toBe(4);
  });

  // ── Rule 1: the card is a spell ───────────────────────────────────────────

  test("the check counts as required by a spell — Wizard's Staff applies its +2", () => {
    const base = orgState({ characters: [PALLANDO], hand: [WIZARDS_VOICE] });
    const withStaff = attachItemToChar(base, RESOURCE_PLAYER, PALLANDO, WIZARDS_STAFF);
    const pallandoId = findCharInstanceId(withStaff, RESOURCE_PLAYER, PALLANDO);

    const after = dispatch(withStaff, voiceActions(withStaff)[0]);
    const spellCheck = viableActions(after, PLAYER_1, 'corruption-check')[0].action as CorruptionCheckAction;
    // Staff CP(2) + 1 - (card -3 + staff's spell bonus +2) = 4.
    expect(spellCheck.need).toBe(4);

    // Control: the same character, the same -3, but a check whose source is not
    // a spell card — the staff's bonus does not apply, so the need is 2 higher.
    const control = enqueueCorruptionCheck(recomputeDerived(withStaff), PLAYER_1, pallandoId, -3);
    const controlCheck = viableActions(control, PLAYER_1, 'corruption-check')[0].action as CorruptionCheckAction;
    expect(controlCheck.need).toBe(spellCheck.need + 2);
  });

  // ── Rule 6: "Cannot be duplicated on a given turn" ────────────────────────

  test('a second copy is unplayable for the rest of the turn — even on a different Wizard', () => {
    const state = orgState({
      characters: [PALLANDO, RADAGAST],
      hand: [WIZARDS_VOICE, WIZARDS_VOICE],
    });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);

    // Both Wizards start out as legal targets.
    const targetsBefore = new Set(voiceActions(state).map(a => a.targetCharacterId));
    expect(targetsBefore).toEqual(new Set([pallandoId, radagastId]));

    const after = playVoiceAndResolveCheck(state, pallandoId);

    // The surviving copy cannot be played on anyone this turn — the limit is
    // turn-scoped, so Radagast is barred too.
    expect(voiceActions(after)).toHaveLength(0);
    // The card is reported as not playable rather than silently dropped.
    const surviving = findHandCardId(after, RESOURCE_PLAYER, WIZARDS_VOICE);
    expect(
      computeLegalActions(after, PLAYER_1).some(
        ea => !ea.viable
          && ea.action.type === 'not-playable'
          && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === surviving,
      ),
    ).toBe(true);
  });
});
