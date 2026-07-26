/**
 * @module ba-21.test
 *
 * Card test: Monstrosity of Diverse Shape (ba-21)
 * Type: hazard-event (permanent), Unique, Spawn, 4 kill MP
 *
 * Card text:
 *   "Unique. Spawn. The Drowning-deeps and Remains of Thangorodrim each have an
 *    additional automatic-attack: Spawn — 2 strikes with 15/9. In addition,
 *    once per turn the hazard player may use one against the hazard limit to
 *    play a Wolf or Animal hazard creature from his discard pile. This card
 *    must have already attacked the company this turn."
 *
 * Two abilities:
 *   (1) `permanent-event-auto-attack` — while in play, The Drowning-deeps
 *       (ba-89) and Remains of Thangorodrim (ba-95) each gain an extra Spawn
 *       automatic-attack (2 strikes, 15 prowess, 9 body), appended after the
 *       site's printed Drake attack.
 *   (2) `grant-replay-attacked-creature` — during the hazard player's M/H
 *       play-hazards window, they may replay a Wolf/Animal hazard creature
 *       from their discard pile against the active company, provided that
 *       creature already attacked the company this M/H phase (its name is in
 *       `hazardsEncountered`). The replay counts against the hazard limit and
 *       may be used only once per company's M/H phase. (Per the French text
 *       "Cette créature doit déjà avoir attaquée cette compagnie ce tour-ci",
 *       the "already attacked" gate is on the replayed creature, which is what
 *       makes the ability temporally reachable — site auto-attacks resolve in
 *       the site phase, after the M/H hazard window.)
 *
 * Engine Support:
 * | # | Rule                                                | Status |
 * |---|-----------------------------------------------------|--------|
 * | 1 | Extra Spawn auto-attack at ba-89 / ba-95            | IMPL   |
 * | 2 | No extra attack when the card is not in play        | IMPL   |
 * | 3 | Replay offered for a Wolf/Animal that attacked      | IMPL   |
 * | 4 | Only Wolf/Animal creatures eligible (filter)        | IMPL   |
 * | 5 | Gated on "already attacked this turn"               | IMPL   |
 * | 6 | Only when the creature can still be keyed           | IMPL   |
 * | 7 | Counts against the hazard limit                     | IMPL   |
 * | 8 | Once per company M/H phase; needs the card in play  | IMPL   |
 * | 9 | Reducer brings creature into combat from discard    | IMPL   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  ORC_PATROL,
  buildTestState, buildSitePhaseState, setupAutoAttackStep,
  addP2CardsInPlay, addCardInPlay,
  viableActions, dispatch, resolveChain, resetMint,
  makeWildernessMHState, makeShadowMHState,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState, MovementHazardPhaseState } from '../../index.js';
import { CardStatus } from '../../index.js';

const MONSTROSITY = 'ba-21' as CardDefinitionId;
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;
const REMAINS_OF_THANGORODRIM = 'ba-95' as CardDefinitionId;
const WOLVES = 'tw-114' as CardDefinitionId; // race "wolf", keys {b}{w}, 3 strikes / 8 prowess
const CREBAIN = 'tw-25' as CardDefinitionId; // race "animal", keys wilderness, 1 strike / 5 prowess

const monstrosityInPlay: CardInPlay = {
  instanceId: 'monstrosity-1' as CardInstanceId,
  definitionId: MONSTROSITY,
  status: CardStatus.Untapped,
};

/**
 * Movement/Hazard play-hazards state for the replay ability: P1 (resource) has
 * a company at MORIA; P2 (hazard) holds the given discard pile and — when
 * `withMonstrosity` — the Monstrosity permanent-event in play.
 */
function replaySetup(opts: {
  hazardDiscard: CardDefinitionId[];
  encountered?: string[];
  mh?: MovementHazardPhaseState;
  withMonstrosity?: boolean;
}): GameState {
  const mh = opts.mh ?? makeWildernessMHState({ hazardsEncountered: opts.encountered ?? [] });
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], discardPile: opts.hazardDiscard, siteDeck: [RIVENDELL] },
    ],
  });
  state = { ...state, phaseState: mh };
  if (opts.withMonstrosity ?? true) {
    state = addCardInPlay(state, HAZARD_PLAYER, MONSTROSITY);
  }
  return state;
}

describe('Monstrosity of Diverse Shape (ba-21)', () => {
  beforeEach(() => resetMint());

  // ─── Ability 1: extra Spawn automatic-attack at ba-89 / ba-95 ──────────────

  test('The Drowning-deeps gains a 2nd auto-attack (Spawn, 2 strikes / 15 prowess) while in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DROWNING_DEEPS, characters: [ARAGORN] }), [monstrosityInPlay]),
    );
    // Skip the printed Drake attack (index 0) to reach the appended Spawn attack.
    const state = { ...base, phaseState: { ...base.phaseState, automaticAttacksResolved: 1 } } as GameState;
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureBody).toBe(9);
  });

  test('Remains of Thangorodrim gains the same extra Spawn auto-attack while in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: REMAINS_OF_THANGORODRIM, characters: [ARAGORN] }), [monstrosityInPlay]),
    );
    const state = { ...base, phaseState: { ...base.phaseState, automaticAttacksResolved: 1 } } as GameState;
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureBody).toBe(9);
  });

  test('defeating the extra Spawn attack removes the card from play and awards its 4 kill MP to the defender (CoE 964)', () => {
    // Aragorn (prowess 9) tapping to fight with a max roll (9 + 12 = 21) defeats
    // each of the two 15-prowess strikes, so the Spawn attack is defeated.
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: DROWNING_DEEPS, characters: [ARAGORN] }), [monstrosityInPlay]),
    );
    const state = { ...base, phaseState: { ...base.phaseState, automaticAttacksResolved: 1 } } as GameState;
    const aragornId = state.players[0].companies[0].characters[0];

    let next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat!.strikesTotal).toBe(2);

    // Drive the whole combat: assign both strikes to Aragorn, pick strike order,
    // and defeat each by tapping to fight with a max roll (9 + 12 = 21 > 15).
    let guard = 0;
    while (next.combat !== null && guard++ < 30) {
      const phase = next.combat.phase;
      if (phase === 'assign-strikes') {
        next = dispatch(next, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
        continue;
      }
      if (phase === 'choose-strike-order') {
        const orderActions = viableActions(next, PLAYER_1, 'choose-strike-order');
        next = dispatch(next, orderActions[0].action);
        continue;
      }
      if (phase === 'resolve-strike') {
        const cheat = { ...next, cheatRollTotal: 12 } as GameState;
        const resolveActions = viableActions(cheat, PLAYER_1, 'resolve-strike');
        const tap = resolveActions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
          ?? resolveActions[0].action;
        next = dispatch(cheat, tap);
        continue;
      }
      // Any residual roll phase (e.g. body-check) — resolve for whichever player.
      const anyRoll = viableActions({ ...next, cheatRollTotal: 12 } as GameState, PLAYER_1, 'body-check-roll')
        .concat(viableActions({ ...next, cheatRollTotal: 12 } as GameState, PLAYER_2, 'body-check-roll'));
      if (anyRoll.length > 0) { next = dispatch({ ...next, cheatRollTotal: 12 } as GameState, anyRoll[0].action); continue; }
      break;
    }
    expect(next.combat).toBeNull();

    // The Monstrosity left the hazard player's cardsInPlay...
    expect(next.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === monstrosityInPlay.instanceId)).toBe(false);
    // ...and is in the defending player's (PLAYER_1, index 0) kill pile.
    expect(next.players[0].killPile.some(c => c.instanceId === monstrosityInPlay.instanceId)).toBe(true);
  });

  test('without the card in play, The Drowning-deeps has only its printed Drake attack', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DROWNING_DEEPS, characters: [ARAGORN] }));
    // First attack is the printed Drake (2 strikes / 11 prowess)...
    const first = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(first.combat).not.toBeNull();
    expect(first.combat!.strikeProwess).toBe(11);
    // ...and there is no 2nd auto-attack.
    const atSecond = { ...state, phaseState: { ...state.phaseState, automaticAttacksResolved: 1 } } as GameState;
    const next = dispatch(atSecond, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  // ─── Ability 2: replay a Wolf/Animal creature from the discard pile ────────

  test('offered for a Wolf creature that already attacked the company this turn', () => {
    const state = replaySetup({ hazardDiscard: [WOLVES], encountered: ['Wolves'] });
    const actions = viableActions(state, PLAYER_2, 'spawn-replay-creature');
    expect(actions.length).toBeGreaterThan(0);
    const wolfId = state.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === WOLVES)!.instanceId;
    for (const { action } of actions) {
      expect((action as { creatureInstanceId: string }).creatureInstanceId).toBe(wolfId);
    }
  });

  test('offered for an Animal creature too (Crebain)', () => {
    const state = replaySetup({ hazardDiscard: [CREBAIN], encountered: ['Crebain'] });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature').length).toBeGreaterThan(0);
  });

  test('not offered for a non-Wolf/Animal creature (Orc-patrol) even if it attacked', () => {
    const state = replaySetup({ hazardDiscard: [ORC_PATROL], encountered: ['Orc-patrol'] });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });

  test('not offered when the creature has not attacked the company this turn', () => {
    // Wolves in discard, but hazardsEncountered is empty → gate not satisfied.
    const state = replaySetup({ hazardDiscard: [WOLVES], encountered: [] });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });

  test('not offered when the creature can no longer be keyed to the site', () => {
    // Wolves key to border/wilderness only; a shadow-only path cannot key them.
    const mh = makeShadowMHState({ hazardsEncountered: ['Wolves'] });
    const state = replaySetup({ hazardDiscard: [WOLVES], mh });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });

  test('not offered when the Monstrosity is not in play', () => {
    const state = replaySetup({ hazardDiscard: [WOLVES], encountered: ['Wolves'], withMonstrosity: false });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });

  test('not offered when the hazard limit is already reached (the replay counts against it)', () => {
    const mh = makeWildernessMHState({ hazardsEncountered: ['Wolves'], hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 });
    const state = replaySetup({ hazardDiscard: [WOLVES], mh });
    expect(viableActions(state, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });

  test('playing the replay brings the creature into combat and removes it from the discard pile', () => {
    const state = replaySetup({ hazardDiscard: [WOLVES], encountered: ['Wolves'] });
    const wolfId = state.players[HAZARD_PLAYER].discardPile[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'spawn-replay-creature');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    // Wolves left the discard pile (it now resides on the chain entry).
    expect(afterPlay.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === wolfId)).toBe(false);
    // The replay counted one against the hazard limit.
    expect((afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);

    // Resolving the chain initiates the Wolves attack (3 strikes / 8 prowess).
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('may only be used once per company M/H phase (source recorded, then not re-offered)', () => {
    const state = replaySetup({ hazardDiscard: [WOLVES, CREBAIN], encountered: ['Wolves', 'Crebain'] });
    const actions = viableActions(state, PLAYER_2, 'spawn-replay-creature');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    // The source permanent-event is marked used this M/H phase...
    const used = (afterPlay.phaseState as MovementHazardPhaseState).spawnReplayUsedSources ?? [];
    expect(used.length).toBe(1);
    // ...so no further replay is offered even though Crebain remains in discard.
    expect(viableActions(afterPlay, PLAYER_2, 'spawn-replay-creature')).toHaveLength(0);
  });
});
