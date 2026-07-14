/**
 * @module ba-18.test
 *
 * Card test: Fled into Darkness (ba-18)
 * Type: hazard-event (permanent), non-unique, Balrog-specific
 *
 * Text:
 *   "Playable before the strike sequence on The Balrog facing a strike with a
 *    prowess higher than his. The strike is canceled and The Balrog taps, if
 *    untapped. The next time The Balrog would otherwise untap, make him tapped
 *    instead and discard this card. Cannot be duplicated."
 *
 * Effects:
 * | # | Rule (card text)                                       | Encoding                          |
 * |---|--------------------------------------------------------|-----------------------------------|
 * | 1 | Playable when The Balrog faces a strike whose prowess  | flee-from-strike                  |
 * |   |  is higher than his; cancel the strike, tap him, then  |  { characterName: "The Balrog" }  |
 * |   |  keep him tapped through his next untap + discard card |  (+ skip-next-untap constraint)   |
 * | 2 | "Cannot be duplicated."                                | duplication-limit game/max 1      |
 *
 * Playable: YES. The Balrog's controller (the defending player) may play the
 * card from hand during the resolve-strike sub-phase when the current strike is
 * assigned to The Balrog and its prowess strictly exceeds his effective prowess
 * (8). Playing it cancels that strike, taps The Balrog, and installs a one-shot
 * `skip-next-untap` constraint; the card enters play and is discarded the next
 * time The Balrog would untap (he stays tapped instead).
 *
 * Fixtures: The Balrog player (P1, defending, alignment balrog) facing an
 * automatic-attack at MORIA; the hazard player (P2) is the attacker.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, mint, addP1CardsInPlay,
  makeCancelWindowCombat, findCharInstanceId, findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, CardInPlay } from '../../index.js';

const FLED_INTO_DARKNESS = 'ba-18' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId; // balrog avatar, prowess 8
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // minion warrior

/**
 * Build a Movement/Hazard combat with the defending Balrog company (P1) facing a
 * single automatic-attack strike (prowess `strikeProwess`) assigned to the given
 * `struck` character. The combat is placed directly in the resolve-strike window
 * (attacker Step 1 already passed) so the defender may respond.
 */
function balrogFacingStrike(opts: {
  strikeProwess?: number;
  struck?: CardDefinitionId;
  characters?: CardDefinitionId[];
  hand?: CardDefinitionId[];
} = {}): GameState {
  const characters = opts.characters ?? [THE_BALROG];
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog,
        companies: [{ site: MORIA, characters }],
        hand: opts.hand ?? [FLED_INTO_DARKNESS], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const withCombat = makeCancelWindowCombat(base, {
    attackSourceType: 'automatic-attack',
    creatureRace: 'orc',
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 12,
  });
  const struckId = findCharInstanceId(withCombat, RESOURCE_PLAYER, opts.struck ?? THE_BALROG);
  return {
    ...withCombat,
    combat: {
      ...withCombat.combat!,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      currentStrikeIndex: 0,
      attackerStep1Done: true,
      strikeAssignments: [{ characterId: struckId, excessStrikes: 0, resolved: false }],
    },
  };
}

/** Move a post-combat state into the Balrog player's untap phase. */
function toUntapPhase(state: GameState): GameState {
  return {
    ...state,
    activePlayer: PLAYER_1,
    phaseState: {
      phase: Phase.Untap, untapped: false, hazardSideboardDestination: null,
      hazardSideboardFetched: 0, hazardSideboardAccessed: false,
      resourcePlayerPassed: false, hazardPlayerPassed: false,
    } as GameState['phaseState'],
  };
}

describe('Fled into Darkness (ba-18)', () => {
  beforeEach(() => resetMint());

  // ── Playability gate ───────────────────────────────────────────────────────

  test('offered to the Balrog player when the strike prowess exceeds his (8)', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    const actions = viableActions(state, PLAYER_1, 'flee-from-strike');
    expect(actions).toHaveLength(1);
    const card = findHandCardId(state, RESOURCE_PLAYER, FLED_INTO_DARKNESS);
    expect((actions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId).toBe(card);
  });

  test('NOT offered when the strike prowess is not higher than his prowess', () => {
    // The Balrog's effective prowess is 8; a strike of exactly 8 does not qualify.
    const state = balrogFacingStrike({ strikeProwess: 8 });
    expect(viableActions(state, PLAYER_1, 'flee-from-strike')).toHaveLength(0);
  });

  test('NOT offered to the attacking (hazard) player', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    expect(viableActions(state, PLAYER_2, 'flee-from-strike')).toHaveLength(0);
  });

  test('NOT offered when a character other than The Balrog faces the strike', () => {
    const state = balrogFacingStrike({
      strikeProwess: 12,
      characters: [THE_BALROG, ORC_CAPTAIN],
      struck: ORC_CAPTAIN,
    });
    expect(viableActions(state, PLAYER_1, 'flee-from-strike')).toHaveLength(0);
  });

  test('NOT offered when a copy is already in play (cannot be duplicated)', () => {
    let state = balrogFacingStrike({ strikeProwess: 12 });
    state = addP1CardsInPlay(state, [
      { instanceId: mint(), definitionId: FLED_INTO_DARKNESS, status: CardStatus.Untapped },
    ] as CardInPlay[]);
    expect(viableActions(state, PLAYER_1, 'flee-from-strike')).toHaveLength(0);
  });

  // ── On play: cancel the strike, tap The Balrog, install the delayed skip ─────

  test('playing it cancels the strike, taps The Balrog, and enters play with a skip-next-untap constraint', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FLED_INTO_DARKNESS);
    const action = viableActions(state, PLAYER_1, 'flee-from-strike')[0].action;

    const after = dispatch(state, action);

    // Single-strike attack: canceling the strike ends combat.
    expect(after.combat).toBeNull();
    // The Balrog taps.
    expect(after.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    // The card leaves hand and enters play (no instance lost, not yet discarded).
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(false);
    // A one-shot skip-next-untap constraint targets The Balrog.
    const constraints = after.activeConstraints.filter(c => c.kind.type === 'skip-next-untap');
    expect(constraints).toHaveLength(1);
    expect(constraints[0].target.kind === 'character' && constraints[0].target.characterId).toBe(balrogId);
    expect(constraints[0].scope.kind).toBe('until-cleared');
  });

  test('an already-tapped Balrog is not re-tapped, and the strike is still canceled', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const preTapped: GameState = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [balrogId]: { ...state.players[RESOURCE_PLAYER].characters[balrogId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const action = viableActions(preTapped, PLAYER_1, 'flee-from-strike')[0].action;
    const after = dispatch(preTapped, action);

    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(1);
  });

  // ── Delayed effect: The Balrog stays tapped next untap + card is discarded ───

  test('at the next untap The Balrog stays tapped and the card is discarded', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, FLED_INTO_DARKNESS);
    const action = viableActions(state, PLAYER_1, 'flee-from-strike')[0].action;

    const afterFlee = dispatch(state, action);
    expect(afterFlee.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);

    // Advance to the Balrog player's untap phase and untap.
    const afterUntap = dispatch(toUntapPhase(afterFlee), { type: 'untap', player: PLAYER_1 });

    // The Balrog would normally untap — instead he stays tapped.
    expect(afterUntap.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    // The card is discarded and removed from play.
    expect(afterUntap.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    expect(afterUntap.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
    // The one-shot constraint is consumed.
    expect(afterUntap.activeConstraints.filter(c => c.kind.type === 'skip-next-untap')).toHaveLength(0);
  });

  test('a second, later untap untaps The Balrog normally (skip was one-shot)', () => {
    const state = balrogFacingStrike({ strikeProwess: 12 });
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const action = viableActions(state, PLAYER_1, 'flee-from-strike')[0].action;
    const afterFlee = dispatch(state, action);

    const firstUntap = dispatch(toUntapPhase(afterFlee), { type: 'untap', player: PLAYER_1 });
    expect(firstUntap.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);

    // A subsequent untap (no constraint left) untaps The Balrog as normal.
    const secondUntap = dispatch(toUntapPhase(firstUntap), { type: 'untap', player: PLAYER_1 });
    expect(secondUntap.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Untapped);
  });
});
