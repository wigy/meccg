/**
 * @module as-77.test
 *
 * Card test: Above the Abyss (as-77)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * "Playable on a tapped non-Ringwraith character if your opponent is a
 *  Wizard and your Ringwraith is in play. Untap target character. Cannot
 *  be included in a Balrog's deck."
 *
 * The card is a resource short-event playable during the Ringwraith
 * player's turn. It carries three DSL effects:
 *   1. play-condition `requires: "player-state"` — gates play on the
 *      opponent being a Wizard player AND the controller having a
 *      Ringwraith avatar in play.
 *   2. play-target character — filter restricts targets to TAPPED,
 *      non-Ringwraith characters in the controller's companies.
 *   3. play-option `untap` — set-character-status untapped on the target.
 *
 * The "Cannot be included in a Balrog's deck" clause is a deck-construction
 * restriction enforced by `validateDeck` (rule 1.23); it is exercised here
 * via a real validation assertion and also covered by the rule-1.23 test.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                        |
 * |---|--------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Gate: opponent is a Wizard                 | IMPLEMENTED | play-condition player-state opponent.alignment|
 * | 2 | Gate: your Ringwraith is in play           | IMPLEMENTED | player.hasRingwraithInPlay                   |
 * | 3 | Target = tapped non-Ringwraith character   | IMPLEMENTED | play-target filter (status + race)           |
 * | 4 | Untap target character                     | IMPLEMENTED | play-option set-character-status untapped    |
 * | 5 | Discard the event after play               | IMPLEMENTED | short-event consumed to discard pile         |
 * | 6 | Cannot be included in a Balrog's deck      | IMPLEMENTED | validateDeck rule 1.23 (BALROG_BANNED)       |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LORIEN,
  CardStatus,
  handCardId, charIdAt, dispatch, resolveChain,
  expectCharStatus, expectInDiscardPile, RESOURCE_PLAYER,
  pool,
} from '../test-helpers.js';
import type {
  CardInstanceId,
  CardDefinitionId,
  DeckList,
  PlayShortEventAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { validateDeck } from '../../index.js';

const ABOVE_THE_ABYSS = 'as-77' as CardDefinitionId;
const DWAR = 'le-52' as CardDefinitionId;        // Ringwraith avatar (race ringwraith, mind null)
const LUITPRAND = 'le-23' as CardDefinitionId;   // minion man, no inherent effects (untap target)
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven

/** P1 = Ringwraith (active resource player), P2 = Wizard (opponent). */
function ringwraithVsWizard(p1Chars: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters']) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: p1Chars }],
        hand: [ABOVE_THE_ABYSS],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
  });
}

describe('Above the Abyss (as-77)', () => {
  beforeEach(() => resetMint());

  test('playable: opponent is a Wizard, own Ringwraith in play, tapped non-Ringwraith target', () => {
    // Dwar (Ringwraith avatar, untapped) + Luitprand (man, tapped).
    const base = ringwraithVsWizard([
      DWAR,
      { defId: LUITPRAND, status: CardStatus.Tapped },
    ]);
    const luitprandId = charIdAt(base, RESOURCE_PLAYER, 0, 1);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === handCardId(base, RESOURCE_PLAYER));

    // Only the tapped non-Ringwraith character (Luitprand) is targetable.
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(luitprandId);
    expect(actions[0].optionId).toBe('untap');
  });

  test('playing it untaps the target character and discards the event', () => {
    const base = ringwraithVsWizard([
      DWAR,
      { defId: LUITPRAND, status: CardStatus.Tapped },
    ]);
    const luitprandId = charIdAt(base, RESOURCE_PLAYER, 0, 1);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const state = resolveChain(dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: luitprandId,
      optionId: 'untap',
    }));

    expectCharStatus(state, RESOURCE_PLAYER, LUITPRAND, CardStatus.Untapped);
    expect(state.players[0].hand).toHaveLength(0);
    expectInDiscardPile(state, RESOURCE_PLAYER, cardInstance);
  });

  test('not playable when opponent is not a Wizard player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [DWAR, { defId: LUITPRAND, status: CardStatus.Tapped }] }],
          hand: [ABOVE_THE_ABYSS],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith, // opponent is a minion, not a Wizard
          companies: [{ site: DOL_GULDUR, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(playActions).toHaveLength(0);

    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('not playable when no Ringwraith is in play', () => {
    // Company has only a tapped non-Ringwraith character — no Ringwraith avatar.
    const base = ringwraithVsWizard([
      { defId: LUITPRAND, status: CardStatus.Tapped },
    ]);

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(playActions).toHaveLength(0);

    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('not playable on a Ringwraith character (filter excludes ringwraith race)', () => {
    // The only tapped candidate is the Ringwraith avatar itself; the
    // non-Ringwraith filter rejects it, so there is no legal target.
    const base = ringwraithVsWizard([
      { defId: DWAR, status: CardStatus.Tapped },
    ]);

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(playActions).toHaveLength(0);

    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('not playable on an untapped character (filter requires tapped)', () => {
    // Dwar (Ringwraith) + Luitprand both untapped: gates pass but no tapped
    // non-Ringwraith target exists.
    const base = ringwraithVsWizard([DWAR, LUITPRAND]);

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).cardInstanceId === handCardId(base, RESOURCE_PLAYER));
    expect(playActions).toHaveLength(0);
  });

  test('cannot be included in a Balrog deck (rule 1.23)', () => {
    const deck: DeckList = {
      id: 'as-77-balrog-ban',
      name: 'Above the Abyss in a Balrog deck',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [],
        resources: [{ name: 'Above the Abyss', card: ABOVE_THE_ABYSS, qty: 1 }],
      },
    };

    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ABOVE_THE_ABYSS && e.message.includes('rule 1.23'))).toBe(true);
  });
});
