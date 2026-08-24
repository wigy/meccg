/**
 * @module wh-90.test
 *
 * Card test: Bow of Alatar (wh-90)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Alatar specific. Place this card on Alatar if he is in play. If on
 *    Alatar, you may tap Bow of Alatar to allow him to face a strike from an
 *    attack against his company regardless of the attack's normal capabilities
 *    and his status. If such a strike fails, the attack's body is reduced by 1."
 *
 * Card shape (from data/cards.json, WH-90): unique, permanent resource event,
 * 0 MP, 2 stage points. It attaches to Alatar (a resource permanent-event, so it
 * lives as an *item* on the bearer) and carries an activated combat ability.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Alatar specific — placed only on Alatar                       | IMPLEMENTED |
 * | 2 | Tap to let Alatar face a strike regardless of his status      | IMPLEMENTED |
 * | 3 | …and regardless of the attack's normal capabilities          | IMPLEMENTED |
 * | 4 | If the faced strike fails, the attack's body is reduced by 1  | IMPLEMENTED |
 * | 5 | Stage points (2) while in play                                | IMPLEMENTED |
 * | 6 | Playable bare when Alatar is NOT in play ("if he is in play") | IMPLEMENTED |
 * | 7 | Attaches to Alatar the moment he enters play                  | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: `play-target` `character` filter `{ target.name: "Alatar" }`.
 *    Alatar is a unique Fallen-wizard avatar, so only the Alatar player can
 *    field him — the target filter is the whole "Alatar specific / place on
 *    Alatar" rule.
 *  - Rules 2–4: `face-strike-on-tap` effect (`bodyReductionOnParry: 1`). During
 *    the `assign-strikes` defender phase the bearer's controller may tap the
 *    (untapped) item to add a strike-facing to the bearer even while he is
 *    tapped/wounded (status bypass) — the new `face-strike-on-tap` combat
 *    action. The assignment is flagged `reduceAttackBodyOnParry`; when the
 *    bearer parries that strike (it fails to wound him), `CombatState.creatureBody`
 *    drops by 1 for the rest of the combat.
 *  - Rule 5: `stage-points` value 2, summed from the bearer's items in
 *    `recompute-derived.ts`.
 *  - Rules 6–7: "Place this card on Alatar **if he is in play**" — placement is
 *    conditional, not a play requirement. An untargeted `play-option` gated on
 *    `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Alatar the moment he is revealed —
 *    the wh-99 / Bade to Rule (le-167) pattern.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions, viablePlayCharacterActions,
  findCharInstanceId, findHandCardId, getCharacter,
  playPermanentEventAndResolve,
  makeSingleCharCombatState, attachItemToChar,
  dispatch, executeAction,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import { Phase, Alignment, CardStatus, Race } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Bow of Alatar — the card under test. */
const BOW_OF_ALATAR = 'wh-90' as CardDefinitionId;
/** Alatar — the Fallen-wizard avatar this card is placed on. */
const ALATAR = 'wh-1' as CardDefinitionId;
/** Boromir II — a hero character; negative control for "place on Alatar". */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (a valid FW starting site). */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** The White Towers — a Wilderness Ruins & Lairs matching Alatar's home-site
 *  rule, so he can be revealed there from hand. */
const THE_WHITE_TOWERS = 'tw-430' as CardDefinitionId;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Fallen-wizard organization state with Alatar in play and the bow in hand. */
function alatarOrgState(characters: CardDefinitionId[] = [ALATAR, BOROMIR]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters }],
        hand: [BOW_OF_ALATAR],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** Build a one-strike creature combat against Alatar with the bow attached. */
function bowCombat(opts: { alatarStatus?: CardStatus; bowStatus?: CardStatus; creatureBody?: number | null } = {}): {
  state: GameState;
  alatarId: CardInstanceId;
  bowId: CardInstanceId;
} {
  let state = makeSingleCharCombatState({
    heroDefId: ALATAR,
    creatureRace: Race.Orc,
    creatureProwess: 4,
    creatureBody: opts.creatureBody ?? 9,
  });
  const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
  state = attachItemToChar(state, RESOURCE_PLAYER, ALATAR, BOW_OF_ALATAR);
  const bowId = state.players[RESOURCE_PLAYER].characters[alatarId].items
    .find(i => i.definitionId === BOW_OF_ALATAR)!.instanceId;

  // Optional status overrides on Alatar and/or the bow.
  const alatar = state.players[RESOURCE_PLAYER].characters[alatarId];
  const updatedAlatar = {
    ...alatar,
    ...(opts.alatarStatus ? { status: opts.alatarStatus } : {}),
    items: opts.bowStatus
      ? alatar.items.map(i => (i.instanceId === bowId ? { ...i, status: opts.bowStatus! } : i))
      : alatar.items,
  };
  const updatedPlayer = {
    ...state.players[RESOURCE_PLAYER],
    characters: { ...state.players[RESOURCE_PLAYER].characters, [alatarId]: updatedAlatar },
  };
  const p0 = RESOURCE_PLAYER === 0 ? updatedPlayer : state.players[0];
  const p1 = RESOURCE_PLAYER === 0 ? state.players[1] : updatedPlayer;
  return { state: { ...state, players: [p0, p1] as unknown as typeof state.players }, alatarId, bowId };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Bow of Alatar (wh-90)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Alatar specific — placed only on Alatar ────────────────────────

  test('offered only on Alatar, never on another character', () => {
    const state = alatarOrgState([ALATAR, BOROMIR]);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(alatarId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // only Alatar
  });

  test('not offered when the player does not count as Alatar (no avatar anywhere)', () => {
    // No Alatar in play, hand, deck or sideboard → the player's declared avatar
    // cannot be resolved, so the `alatar-specific` keyword gate blocks the play
    // entirely. (With Alatar merely unrevealed — still in hand — the card IS
    // playable bare; see Rules 6–7 below.)
    const state = alatarOrgState([BOROMIR]);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('attaches to Alatar as an item when played', () => {
    const base = alatarOrgState([ALATAR, BOROMIR]);
    const alatarId = findCharInstanceId(base, RESOURCE_PLAYER, ALATAR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, BOW_OF_ALATAR);

    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, alatarId);
    const alatar = after.players[RESOURCE_PLAYER].characters[alatarId];
    expect(alatar.items.some(i => i.definitionId === BOW_OF_ALATAR)).toBe(true);
  });

  // ── Rule 5: stage points ───────────────────────────────────────────────────

  test('contributes 2 stage points and 1 corruption point while attached to Alatar', () => {
    const base = alatarOrgState([ALATAR, BOROMIR]);
    const alatarId = findCharInstanceId(base, RESOURCE_PLAYER, ALATAR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, BOW_OF_ALATAR);
    const cpBefore = getCharacter(base, RESOURCE_PLAYER, ALATAR).effectiveStats.corruptionPoints;

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, alatarId);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    expect(getCharacter(after, RESOURCE_PLAYER, ALATAR).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ── Rule 2/3: tap to let Alatar face a strike regardless of status ─────────

  test('offers the face-strike action during defender assignment (Alatar untapped)', () => {
    const { state, alatarId, bowId } = bowCombat();
    const actions = viableActions(state, PLAYER_1, 'face-strike-on-tap');
    expect(actions.length).toBe(1);
    const a = actions[0].action as { cardInstanceId: CardInstanceId; characterInstanceId: CardInstanceId };
    expect(a.cardInstanceId).toBe(bowId);
    expect(a.characterInstanceId).toBe(alatarId);
  });

  test('offers the face-strike action even while Alatar is tapped (status bypass)', () => {
    // A tapped character is normally NOT assignable by the defender — but the
    // bow lets Alatar face a strike "regardless of his status".
    const { state, alatarId } = bowCombat({ alatarStatus: CardStatus.Tapped });

    const normal = viableActions(state, PLAYER_1, 'assign-strike')
      .map(ea => (ea.action as { characterId?: unknown }).characterId);
    expect(normal).not.toContain(alatarId); // tapped → no ordinary assignment

    const bow = viableActions(state, PLAYER_1, 'face-strike-on-tap');
    expect(bow.length).toBe(1); // …but the bow still offers it
  });

  test('offers the face-strike action even while Alatar is wounded (status bypass)', () => {
    const { state } = bowCombat({ alatarStatus: CardStatus.Inverted });
    expect(viableActions(state, PLAYER_1, 'face-strike-on-tap').length).toBe(1);
  });

  test('not offered when the bow is already tapped', () => {
    const { state } = bowCombat({ bowStatus: CardStatus.Tapped });
    expect(viableActions(state, PLAYER_1, 'face-strike-on-tap').length).toBe(0);
  });

  test('activating taps the bow and assigns Alatar a flagged strike', () => {
    const { state, alatarId, bowId } = bowCombat({ alatarStatus: CardStatus.Tapped });
    const action = viableActions(state, PLAYER_1, 'face-strike-on-tap')[0].action;
    const after = dispatch(state, action);

    // Bow tapped.
    const bow = after.players[RESOURCE_PLAYER].characters[alatarId].items
      .find(i => i.instanceId === bowId)!;
    expect(bow.status).toBe(CardStatus.Tapped);

    // Alatar now faces a strike flagged to reduce the attack's body on a parry.
    const assignment = after.combat!.strikeAssignments.find(s => s.characterId === alatarId);
    expect(assignment).toBeDefined();
    expect(assignment!.reduceAttackBodyOnParry).toBe(1);

    // Single-strike attack fully allocated → resolution begins.
    expect(after.combat!.phase).toBe('resolve-strike');
  });

  // ── Rule 4: a failed (parried) strike reduces the attack's body by 1 ───────

  test('parrying the faced strike reduces the attack body by 1', () => {
    const { state } = bowCombat({ creatureBody: 9 });
    const action = viableActions(state, PLAYER_1, 'face-strike-on-tap')[0].action;
    const assigned = dispatch(state, action);
    expect(assigned.combat!.creatureBody).toBe(9); // not yet resolved

    // Alatar (prowess 7) rolls 12 → 19 vs creature prowess 4 → parry.
    const afterStrike = executeAction(assigned, PLAYER_1, 'resolve-strike', 12, false);

    // Strike failed to wound Alatar → attack body reduced 9 → 8, and the
    // ensuing creature body check uses the reduced value.
    expect(afterStrike.combat!.creatureBody).toBe(8);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
  });

  test('an ordinary (non-bow) strike does not reduce the attack body', () => {
    // Baseline: assign the strike to Alatar normally (untapped) and parry — the
    // attack body is unchanged, proving the reduction is the bow's doing.
    const { state, alatarId } = bowCombat({ creatureBody: 9 });
    const assigned = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: alatarId });
    const afterStrike = executeAction(assigned, PLAYER_1, 'resolve-strike', 12, false);
    expect(afterStrike.combat!.creatureBody).toBe(9);
  });

  // ── Rules 6–7: playable without Alatar, attaches on his reveal ─────────────
  // "Place this card on Alatar if he is in play" makes the placement
  // conditional, not the play. Mirrors Huntsman's Garb (wh-92) / Give Welcome
  // to the Unexpected (wh-99) / Bade to Rule (le-167).

  /** Organization-phase state with Alatar NOT in play: he sits in hand (still
   *  the declared avatar, so the alatar-specific gate passes) and his home
   *  site heads the site deck so he can be revealed. */
  function alatarUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [BOW_OF_ALATAR, ALATAR],
          siteDeck: [THE_WHITE_TOWERS],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD],
          playDeck: makePlayDeck(),
        },
      ],
    });
  }

  test('playable bare during the organization phase when Alatar is not in play', () => {
    const state = alatarUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const bowId = findHandCardId(state, RESOURCE_PLAYER, BOW_OF_ALATAR);
    const after = playPermanentEventAndResolve(state, PLAYER_1, bowId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BOW_OF_ALATAR)).toBe(true);
    // The stage points are earned whether or not the card sits on Alatar.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('attaches to Alatar the moment he enters play', () => {
    const org = alatarUnrevealedOrgState();
    const bowId = findHandCardId(org, RESOURCE_PLAYER, BOW_OF_ALATAR);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, bowId);

    // Reveal Alatar at his home site — the bow leaves `cardsInPlay` for his items.
    const playAlatar = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, ALATAR));
    expect(playAlatar).toBeDefined();
    const revealed = dispatch(bare, playAlatar!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === BOW_OF_ALATAR)).toBe(false);
    const alatarId = findCharInstanceId(revealed, RESOURCE_PLAYER, ALATAR);
    expect(revealed.players[RESOURCE_PLAYER].characters[alatarId].items
      .some(i => i.definitionId === BOW_OF_ALATAR)).toBe(true);
    expect(revealed.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });
});
