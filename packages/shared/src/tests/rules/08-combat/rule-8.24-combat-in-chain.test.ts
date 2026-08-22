/**
 * @module rule-8.24-combat-in-chain
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.24: Combat During Chain of Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Per the normal rules for a chain of effects resolving, if combat takes place during a chain of effects and there are additional effects in the same chain of effects that haven't yet resolved, only the prescribed actions can be taken for each step of combat and other actions cannot be taken between strikes sequences or at other times. This includes combat that takes place during the resolution of an event if that same event has effects that will resolve after the attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  buildMinionSitePhaseState,
  resetMint,
  viableActions,
  playPermanentEventAndResolve,
  runCardTriggeredAttackCombat,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { CardDefinitionId, CardInstanceId, GameState, GameAction, PlayPermanentEventAction } from '../../../index.js';

// Descent through Fire (ba-56): a Balrog permanent-event that, on play,
// makes the Balrog's own company face THREE Troll attacks (a card-triggered
// combat in the middle of the event's resolution) and only AFTER those
// attacks resolve does its trailing effect run — the player taps The Balrog
// to keep the card (a select-card-bearer window) and gain the +1 prowess /
// +1 direct-influence buffs. That post-attack window is exactly the "effect
// in the same chain that hasn't yet resolved" the rule is about.
const DESCENT = 'ba-56' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;

/** Action types that must never be offered while a strike sequence is unresolved. */
const NON_COMBAT_TYPES: ReadonlySet<GameAction['type']> = new Set([
  'play-permanent-event', 'play-short-event', 'play-hazard', 'play-character',
  'play-hero-resource', 'plan-movement', 'select-card-bearer',
] as GameAction['type'][]);

describe('Rule 8.24 — Combat During Chain of Effects', () => {
  beforeEach(() => resetMint());

  test('a card-triggered attack allows only combat actions until it finalizes, then resumes the trailing effect', () => {
    const state = buildMinionSitePhaseState({
      site: UNDER_GALLERIES,
      characters: [THE_BALROG],
      hand: [DESCENT],
    });
    const play = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const descentInstanceId: CardInstanceId = play.cardInstanceId;

    // Playing Descent through Fire drops straight into the first triggered
    // attack: combat is active with the event's trailing keep/buff effect
    // still queued.
    let s: GameState = playPermanentEventAndResolve(state, PLAYER_1, descentInstanceId);
    expect(s.combat).not.toBeNull();

    // While any strike sequence is unresolved, the only actions offered are
    // combat actions — the trailing keep/buff step (select-card-bearer) and
    // every other non-combat play are withheld (rule 8.24).
    const duringCombat = computeLegalActions(s, PLAYER_1).filter(a => a.viable);
    expect(duringCombat.length).toBeGreaterThan(0);
    for (const ea of duringCombat) {
      expect(NON_COMBAT_TYPES.has(ea.action.type)).toBe(false);
    }
    // And specifically the trailing effect's own action is not yet available.
    expect(duringCombat.some(a => a.action.type === 'select-card-bearer')).toBe(false);

    // The card is still parked in cardsInPlay awaiting its trailing effect —
    // it has NOT resolved mid-combat.
    const descentDuring = s.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === DESCENT);
    expect(descentDuring?.pendingTriggerAttack).toBe(true);
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DESCENT)).toBe(false);

    // Resolve all three Troll attacks (The Balrog defends each).
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: THE_BALROG, roll: 6 }]); // attack 1 → 2
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 2 → 3
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 3 → done
    expect(s.combat).toBeNull();

    // Only now that combat has fully finalized does the trailing effect resume.
    // A lone Balrog is tapped facing the strikes, so it cannot pay the keep
    // cost and the card resolves by discarding — the point is that this
    // resolution happens AFTER combat, never interleaved with it: the card is
    // no longer a pending-trigger card in play, and it has left for the
    // discard pile.
    expect(s.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === DESCENT)).toBe(false);
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DESCENT)).toBe(true);
  });
});
