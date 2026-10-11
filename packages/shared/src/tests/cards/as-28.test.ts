/**
 * @module as-28.test
 *
 * Card test: Fealty Under Trial (as-28)
 * Type: hazard-event (short)
 *
 * "Playable on a minion in a Darkhaven [{DH}] or Barad-dûr. Make a roll
 *  adding the marshalling points (as though they were stored) and corruption
 *  points of all items and events played with target minion. All items and
 *  storable events played with target minion are then automatically stored
 *  (no corruption checks are made). Then, if the result was greater than 15,
 *  discard the minion (and all other cards played with him)."
 *
 * Engine support:
 * - play-target character filter: `target.cardType` minion-character, and
 *   the company's site (new site when moving, else current) is a Darkhaven
 *   (`company.atDarkhaven`) or Barad-dûr (`company.siteName`).
 * - stored-value-roll (threshold 15): on resolution the card's player rolls a
 *   `dice-check` with a constant modifier = MP (storable-at override, else
 *   printed) + CP of every item / resource event the target bears. Both
 *   branches run `store-character-cards` (items + storable-at events move to
 *   the owner's marshalling-point pile, no corruption check); a total > 15
 *   additionally discards the minion with his remaining cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LORIEN, MORIA,
  buildTestState, resetMint,
  makeMHState,
  P1_COMPANY,
  handCardId, findCharInstanceId, dispatch, resolveChain, rollDiceCheck,
  hazardCharacterTargets,
  getCharacter, expectCharInPlay, expectCharNotInPlay,
} from '../test-helpers.js';
import { Alignment, Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId,
} from '../../index.js';

const FEALTY_UNDER_TRIAL = 'as-28' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const HIGH_HELM = 'le-313' as CardDefinitionId; // 2 MP, 2 CP
const BLACK_MACE = 'le-299' as CardDefinitionId; // 2 MP, 3 CP
const THAT_AINT_NO_SECRET = 'le-240' as CardDefinitionId; // 0 MP printed, stored worth 1

/** Total MP-as-stored + CP of the standard loadout: (2+2) + (2+3) + (1+0). */
const LOADOUT_VALUE = 10;
const LOADOUT = [HIGH_HELM, BLACK_MACE, THAT_AINT_NO_SECRET];

/** M/H-phase state: Gorbag (bearing `items`) plus `others` in P1's minion company at `site`. */
const mhState = (site: CardDefinitionId, items: CardDefinitionId[] = [], others: CardDefinitionId[] = []): GameState => ({
  ...buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [{ defId: GORBAG, items }, ...others] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [FEALTY_UNDER_TRIAL], siteDeck: [MORIA] },
    ],
  }),
  phaseState: makeMHState(),
});

/** Play Fealty Under Trial on Gorbag and let the chain resolve (roll pending). */
const playOnGorbag = (s: GameState): GameState => resolveChain(dispatch(s, {
  type: 'play-hazard',
  player: PLAYER_2,
  cardInstanceId: handCardId(s, HAZARD_PLAYER),
  targetCompanyId: P1_COMPANY,
  targetCharacterId: findCharInstanceId(s, RESOURCE_PLAYER, GORBAG),
}));

describe('Fealty Under Trial (as-28)', () => {
  beforeEach(() => resetMint());

  test('playable on a minion at a Darkhaven', () => {
    for (const site of [DOL_GULDUR, MINAS_MORGUL]) {
      resetMint();
      const s = mhState(site);
      expect(hazardCharacterTargets(s, PLAYER_2)).toEqual([findCharInstanceId(s, RESOURCE_PLAYER, GORBAG)]);
    }
  });

  test('playable on a minion at Barad-dûr', () => {
    const s = mhState(BARAD_DUR);
    expect(hazardCharacterTargets(s, PLAYER_2)).toEqual([findCharInstanceId(s, RESOURCE_PLAYER, GORBAG)]);
  });

  test('not playable on a minion at a non-Darkhaven site', () => {
    const s = mhState(GOBLIN_GATE);
    expect(hazardCharacterTargets(s, PLAYER_2)).toEqual([]);
  });

  test('not playable on a non-minion character even at a Darkhaven', () => {
    const s = mhState(DOL_GULDUR, [], [ARAGORN]);
    const targets = hazardCharacterTargets(s, PLAYER_2);
    expect(targets).toEqual([findCharInstanceId(s, RESOURCE_PLAYER, GORBAG)]);
    expect(targets).not.toContain(findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN));
  });

  test('roll is modified by MP (as though stored) + CP of the items and events', () => {
    const s0 = mhState(DOL_GULDUR, LOADOUT);
    const s = playOnGorbag(s0);
    expect(s.pendingResolutions).toHaveLength(1);
    const dc = s.pendingResolutions[0];
    expect(dc.kind.type).toBe('dice-check');
    // The card's player (the hazard player) makes the roll.
    expect(dc.actor).toBe(PLAYER_2);
    if (dc.kind.type === 'dice-check') {
      const mod = dc.kind.modifiers.reduce((sum, m) => sum + (m.kind === 'constant' ? m.value : 0), 0);
      expect(mod).toBe(LOADOUT_VALUE);
      expect(dc.kind.threshold).toBe(15);
      expect(dc.kind.comparison).toBe('gt');
      expect(dc.kind.roller).toBe(PLAYER_2);
    }
  });

  test('result of 15 or less: items and storable events are stored without corruption checks, minion stays', () => {
    const s0 = mhState(DOL_GULDUR, LOADOUT);
    const gorbagId = findCharInstanceId(s0, RESOURCE_PLAYER, GORBAG);
    // 5 + 10 = 15 — not greater than 15.
    const s = rollDiceCheck(playOnGorbag(s0), PLAYER_2, 5);

    expectCharInPlay(s, RESOURCE_PLAYER, gorbagId);
    expect(getCharacter(s, RESOURCE_PLAYER, GORBAG).items).toHaveLength(0);
    const stored = s.players[0].killPile.map(c => c.definitionId);
    expect(stored).toEqual(expect.arrayContaining([HIGH_HELM, BLACK_MACE, THAT_AINT_NO_SECRET]));
    expect(s.players[0].killPile.every(c => c.storedAtSite === DOL_GULDUR)).toBe(true);
    // No corruption checks are made.
    expect(s.pendingResolutions).toHaveLength(0);
    // The stored cards score: 2 + 2 items, 1 misc (That Ain't No Secret).
    expect(s.players[0].marshallingPoints.item).toBe(4);
    expect(s.players[0].discardPile.map(c => c.definitionId)).not.toContain(GORBAG);
  });

  test('result greater than 15: cards are stored first, then the minion is discarded', () => {
    const s0 = mhState(DOL_GULDUR, LOADOUT);
    const gorbagId = findCharInstanceId(s0, RESOURCE_PLAYER, GORBAG);
    // 6 + 10 = 16 > 15.
    const s = rollDiceCheck(playOnGorbag(s0), PLAYER_2, 6);

    expectCharNotInPlay(s, RESOURCE_PLAYER, gorbagId);
    const discard = s.players[0].discardPile.map(c => c.definitionId);
    expect(discard).toContain(GORBAG);
    // The items and storable event were stored before the discard.
    expect(discard).not.toContain(HIGH_HELM);
    expect(discard).not.toContain(BLACK_MACE);
    const stored = s.players[0].killPile.map(c => c.definitionId);
    expect(stored).toEqual(expect.arrayContaining([HIGH_HELM, BLACK_MACE, THAT_AINT_NO_SECRET]));
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('a minion bearing nothing stays in play — the bare roll cannot exceed 15', () => {
    const s0 = mhState(BARAD_DUR);
    const gorbagId = findCharInstanceId(s0, RESOURCE_PLAYER, GORBAG);
    const s = rollDiceCheck(playOnGorbag(s0), PLAYER_2, 12);
    expectCharInPlay(s, RESOURCE_PLAYER, gorbagId);
    expect(s.players[0].killPile).toHaveLength(0);
  });
});
