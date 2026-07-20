/**
 * @module as-82-eye-never-sleeping.test
 *
 * Card test: Eye Never Sleeping (as-82)
 * Type: minion-resource-event (short)
 *
 * Card text: "Playable if you are Sauron. Cancel one hazard creature attack."
 *
 * Effects:
 *   1. play-condition — requires "player-state", condition
 *      `player.playsAsSauron` (true while a `play-as-sauron` marker such as
 *      The Lidless Eye le-203 is in play for the player).
 *   2. cancel-attack — costless from-hand cancel, `when` attack source is a
 *      hazard creature (`creature` or `on-guard-creature`; automatic attacks
 *      and company-vs-company attacks are not hazard creature attacks).
 *
 * The from-hand costless cancel routes through the chain (Dark Quarrels
 * tw-207 path); the Sauron gate is evaluated in `cancelAttackActions`
 * against the player-state context. Outside combat the card is classified
 * combat-only (its play-condition is a gate, not an independent effect) and
 * is never offered as a generic any-phase short event.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  MINAS_TIRITH, LORIEN,
  viableActions, viableActionsForHandCard,
  makeCancelWindowCombat,
  addP1CardsInPlay,
  dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { CancelAttackAction, CardDefinitionId, GameState } from '../../index.js';

const EYE_NEVER_SLEEPING = 'as-82' as CardDefinitionId;
/** The Lidless Eye — carries the `play-as-sauron` marker (le-203). */
const LIDLESS_EYE = 'le-203' as CardDefinitionId;
/** The Mouth — a non-avatar minion character, race man (le-24). */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Moria — a minion Shadow-hold site (le-392). */
const MORIA_MINION = 'le-392' as CardDefinitionId;
/** Dol Guldur — a minion Darkhaven site (le-367). */
const DOL_GULDUR = 'le-367' as CardDefinitionId;

/** Minion (Ringwraith) defender at Moria with Eye Never Sleeping in hand. */
function minionBase(phase: Phase): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA_MINION, characters: [THE_MOUTH] }],
        hand: [EYE_NEVER_SLEEPING],
        siteDeck: [DOL_GULDUR],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** Mark player 1 as Sauron: The Lidless Eye as a bare card-in-play entry. */
function asSauron(state: GameState): GameState {
  return addP1CardsInPlay(state, [
    { instanceId: mint(), definitionId: LIDLESS_EYE, status: CardStatus.Untapped },
  ]);
}

describe('Eye Never Sleeping (as-82)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered while playing as Sauron against a hazard creature attack', () => {
    const base = asSauron(minionBase(Phase.MovementHazard));
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as CancelAttackAction;
    expect(action.cardInstanceId).toBe(state.players[RESOURCE_PLAYER].hand[0].instanceId);
    // Costless: no cost-paying character attached to the action.
    expect(action.scoutInstanceId).toBeUndefined();
  });

  test('NOT offered when the player is not Sauron', () => {
    const base = minionBase(Phase.MovementHazard);
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered against an automatic-attack even as Sauron', () => {
    const base = asSauron(minionBase(Phase.MovementHazard));
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc', attackSourceType: 'automatic-attack' });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('offered against an on-guard creature (still a hazard creature attack)', () => {
    const base = asSauron(minionBase(Phase.MovementHazard));
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc', attackSourceType: 'on-guard-creature' });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  // ── Resolution ──────────────────────────────────────────────────────

  test('cancel discards the card and cancels the attack via the chain, at no cost', () => {
    const base = asSauron(minionBase(Phase.MovementHazard));
    const state = makeCancelWindowCombat(base, { creatureRace: 'orc' });

    const action = viableActions(state, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const declared = dispatch(state, action);

    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, EYE_NEVER_SLEEPING);
    // Costless cancel: no corruption check or other pending resolution.
    expect(declared.pendingResolutions).toHaveLength(0);
    // Combat stays active until the chain resolves the cancellation.
    expect(declared.combat).not.toBeNull();

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });

  // ── Outside combat ──────────────────────────────────────────────────

  test('not offered as a generic short event outside combat, even as Sauron', () => {
    const state = asSauron(minionBase(Phase.Organization));

    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-short-event', RESOURCE_PLAYER, EYE_NEVER_SLEEPING),
    ).toHaveLength(0);
  });
});
