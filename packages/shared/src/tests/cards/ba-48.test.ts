/**
 * @module ba-48.test
 *
 * Card test: A More Evil Hour (ba-48)
 * Type: minion-resource-event (alignment ringwraith), Permanent-event. 0 MP.
 * Non-unique. Balrog specific.
 *
 * Card text:
 *   "Balrog specific. Tap this card when an opponent plays a card normally
 *    giving him three or more marshalling points. This card does not untap. If
 *    tapped, you may discard this card during your organization phase to target
 *    a company allowed to move with region movement. The company may move up to
 *    two additional regions if moving to a site where an opponent's company is
 *    present — and also, thereafter, when leaving this site."
 *
 * Effects:
 *   1. play-flag no-auto-untap        ("This card does not untap")
 *   2. evil-hour-tap-trigger mp 3     (taps when opponent plays a 3+ MP card)
 *   3. evil-hour-grant-movement +2    (discard while tapped to grant the bonus)
 *
 * "Balrog specific" is a deck-construction keyword with no play-time gate
 * (ba-45/ba-46 precedent). The conditional +2 region grant is read as the
 * symmetric practical reading of "moving to … and also, thereafter, when
 * leaving": +2 when the move's origin OR destination currently holds an
 * opponent's company.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Taps when the opponent plays a 3+ MP card                     | OK     |
 * | 2 | Does not tap on a <3 MP play / on the controller's own play   | OK     |
 * | 3 | Does not untap during the untap phase                         | OK     |
 * | 4 | Discard while tapped (org phase) grants a company the bonus   | OK     |
 * | 5 | Not offered while untapped / for a Balrog-avatar company      | OK     |
 * | 6 | Marked company gets +2 region distance into an occupied site  | OK     |
 * | 7 | Bonus also applies when leaving an opponent-occupied site     | OK     |
 * | 8 | No bonus when neither endpoint holds an opponent's company    | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, Company } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { DeclarePathAction } from '../../types/actions-movement-hazard.js';
import { applyEvilHourTaps } from '../../engine/evil-hour.js';
import {
  buildTestState, resetMint, makeMHState, addCardInPlay,
  reduce, findHandCardId, viableFor,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';

const A_MORE_EVIL_HOUR = 'ba-48' as CardDefinitionId;

const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific, non-avatar, mind 2
const THE_BALROG = 'ba-3' as CardDefinitionId;        // Balrog avatar (region-locked)

// Hero opponent pieces for the tap trigger (played via reduce).
const GANDALF = 'tw-156' as CardDefinitionId;   // wizard avatar (supplies general influence)
const THORIN_II = 'tw-183' as CardDefinitionId; // hero character, 3 MP, mind 8
const KILI = 'tw-167' as CardDefinitionId;      // hero character, 1 MP, mind 3
const RIVENDELL = 'tw-421' as CardDefinitionId; // hero haven

// Balrog sites with known region geography (see ba-71.test).
const BARAD_DUR = 'ba-84' as CardDefinitionId;     // dark-hold, Gorgoroth
const CIRITH_GORGOR = 'ba-86' as CardDefinitionId; // dark-hold, Udûn (2 regions from Barad-dûr)

/** Set a card-in-play's status for `ownerIdx` (addCardInPlay always adds untapped). */
function tapCardInPlay(state: GameState, ownerIdx: 0 | 1, defId: CardDefinitionId): GameState {
  const players = state.players.map((p, i) => i === ownerIdx
    ? { ...p, cardsInPlay: p.cardsInPlay.map(c => c.definitionId === defId ? { ...c, status: CardStatus.Tapped } : c) }
    : p);
  return { ...state, players: players as unknown as typeof state.players };
}

/** Give the first company of `ownerIdx` the evil-hour movement bonus. */
function markEvilHourCompany(state: GameState, ownerIdx: 0 | 1): GameState {
  const players = state.players.map((p, i) => i === ownerIdx
    ? { ...p, companies: p.companies.map((c, ci) => ci === 0 ? { ...c, evilHourMovementBonus: true } : c) }
    : p);
  return { ...state, players: players as unknown as typeof state.players };
}

function declarePathActions(state: GameState, playerId = PLAYER_1): DeclarePathAction[] {
  return viableFor(state, playerId)
    .filter(a => a.action.type === 'declare-path')
    .map(a => a.action as DeclarePathAction);
}

/** Find the in-play A More Evil Hour instance for a player and read its status. */
function evilHourStatus(state: GameState, ownerIdx: 0 | 1): CardStatus | undefined {
  return state.players[ownerIdx].cardsInPlay.find(c => c.definitionId === A_MORE_EVIL_HOUR)?.status;
}

describe('A More Evil Hour (ba-48)', () => {
  beforeEach(() => resetMint());

  describe('taps when an opponent plays a 3+ marshalling-point card', () => {
    // The Balrog player (PLAYER_1) holds A More Evil Hour untapped; the hero
    // opponent (PLAYER_2) is active in his organization phase and plays a
    // character. The tap reaction runs after the reducer step.
    function heroPlaysCharacterState(charInHand: CardDefinitionId): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_2,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR, characters: [CROOK_LEGGED_ORC] }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [GANDALF] }],
            hand: [charInHand],
            siteDeck: [],
          },
        ],
      });
      return addCardInPlay(base, RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
    }

    test('a 3 MP character (Thorin II) taps the card', () => {
      const state = heroPlaysCharacterState(THORIN_II);
      expect(evilHourStatus(state, RESOURCE_PLAYER)).toBe(CardStatus.Untapped);

      const atSite = state.players[HAZARD_PLAYER].companies[0].currentSite!.instanceId;
      const result = reduce(state, {
        type: 'play-character',
        player: PLAYER_2,
        characterInstanceId: findHandCardId(state, HAZARD_PLAYER, THORIN_II),
        atSite,
        controlledBy: 'general',
      });

      expect(result.error).toBeUndefined();
      expect(evilHourStatus(result.state, RESOURCE_PLAYER)).toBe(CardStatus.Tapped);
    });

    test('a 1 MP character (Kíli) does NOT tap the card', () => {
      const state = heroPlaysCharacterState(KILI);

      const atSite = state.players[HAZARD_PLAYER].companies[0].currentSite!.instanceId;
      const result = reduce(state, {
        type: 'play-character',
        player: PLAYER_2,
        characterInstanceId: findHandCardId(state, HAZARD_PLAYER, KILI),
        atSite,
        controlledBy: 'general',
      });

      expect(result.error).toBeUndefined();
      expect(evilHourStatus(result.state, RESOURCE_PLAYER)).toBe(CardStatus.Untapped);
    });
  });

  describe('the tap reaction is scoped to the opponent and is idempotent', () => {
    // A player's OWN 3+ MP play must never tap their own A More Evil Hour, and
    // an already-tapped copy is left tapped. Exercised on the raw reaction that
    // the reducer applies after each step.
    function twoCompanyState(): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR, characters: [CROOK_LEGGED_ORC] }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [GANDALF] }],
            hand: [],
            siteDeck: [],
          },
        ],
      });
      return addCardInPlay(base, RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
    }

    test("the controller's own 3+ MP card entering play does not tap the card", () => {
      const prev = twoCompanyState();
      // Simulate the controller (PLAYER_1) himself bringing a 3 MP card into
      // play: it appears in HIS in-play zone, never the opponent's.
      const next = addCardInPlay(prev, RESOURCE_PLAYER, THORIN_II);
      const reacted = applyEvilHourTaps(prev, next);
      expect(evilHourStatus(reacted, RESOURCE_PLAYER)).toBe(CardStatus.Untapped);
    });

    test('an already-tapped card stays tapped when the opponent plays another 3+ MP card', () => {
      const prev = tapCardInPlay(twoCompanyState(), RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
      const next = addCardInPlay(prev, HAZARD_PLAYER, THORIN_II);
      const reacted = applyEvilHourTaps(prev, next);
      expect(evilHourStatus(reacted, RESOURCE_PLAYER)).toBe(CardStatus.Tapped);
    });

    test("an opponent's 3+ MP card entering play taps an untapped card", () => {
      const prev = twoCompanyState();
      const next = addCardInPlay(prev, HAZARD_PLAYER, THORIN_II);
      const reacted = applyEvilHourTaps(prev, next);
      expect(evilHourStatus(reacted, RESOURCE_PLAYER)).toBe(CardStatus.Tapped);
    });
  });

  describe('does not untap during the untap phase', () => {
    test('a tapped A More Evil Hour stays tapped through the untap phase', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Untap,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR, characters: [CROOK_LEGGED_ORC] }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const tapped = tapCardInPlay(addCardInPlay(base, RESOURCE_PLAYER, A_MORE_EVIL_HOUR), RESOURCE_PLAYER, A_MORE_EVIL_HOUR);

      const result = reduce(tapped, { type: 'untap', player: PLAYER_1 });
      expect(result.error).toBeUndefined();
      expect(evilHourStatus(result.state, RESOURCE_PLAYER)).toBe(CardStatus.Tapped);
    });
  });

  describe('discard while tapped grants a company the region-movement bonus', () => {
    function orgState(): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [
              { site: BARAD_DUR, characters: [CROOK_LEGGED_ORC] },
              { site: CIRITH_GORGOR, characters: [THE_BALROG] },
            ],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      return addCardInPlay(base, RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
    }

    test('the discard action is offered (only) while the card is tapped', () => {
      const untapped = orgState();
      expect(viableFor(untapped, PLAYER_1).some(a => a.action.type === 'discard-for-evil-hour-movement')).toBe(false);

      const tapped = tapCardInPlay(untapped, RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
      const offers = viableFor(tapped, PLAYER_1).filter(a => a.action.type === 'discard-for-evil-hour-movement');
      expect(offers.length).toBe(1); // only the non-Balrog company is a valid target
    });

    test('a Balrog-avatar company is never a valid target (region-locked)', () => {
      const tapped = tapCardInPlay(orgState(), RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
      const balrogCompanyId = tapped.players[RESOURCE_PLAYER].companies[1].id;
      const offers = viableFor(tapped, PLAYER_1)
        .filter(a => a.action.type === 'discard-for-evil-hour-movement')
        .map(a => a.action as { companyId: string });
      expect(offers.some(a => a.companyId === (balrogCompanyId as unknown as string))).toBe(false);
    });

    test('discarding removes the card from play and marks the company', () => {
      const tapped = tapCardInPlay(orgState(), RESOURCE_PLAYER, A_MORE_EVIL_HOUR);
      const targetCompanyId = tapped.players[RESOURCE_PLAYER].companies[0].id;
      const cardId = tapped.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === A_MORE_EVIL_HOUR)!.instanceId;

      const result = reduce(tapped, {
        type: 'discard-for-evil-hour-movement',
        player: PLAYER_1,
        cardInstanceId: cardId,
        companyId: targetCompanyId,
      });

      expect(result.error).toBeUndefined();
      const p1 = result.state.players[RESOURCE_PLAYER];
      expect(p1.cardsInPlay.some(c => c.definitionId === A_MORE_EVIL_HOUR)).toBe(false);
      expect(p1.discardPile.some(c => c.instanceId === cardId)).toBe(true);
      const marked = p1.companies.find((c: Company) => c.id === targetCompanyId)!;
      expect(marked.evilHourMovementBonus).toBe(true);
    });
  });

  describe('the marked company gains +2 region distance near an opponent-occupied site', () => {
    // Barad-dûr (Gorgoroth) → Cirith Gorgor (Udûn) is a 2-region span. With the
    // M/H region cap set to 1, that move is normally illegal; the +2 grant lifts
    // it to 3 so the region path is offered — but only when an opponent's
    // company sits at an endpoint.
    function revealState(opts: {
      marked: boolean;
      oppAt?: CardDefinitionId; // where the hero opponent's company sits
    }): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR, characters: [CROOK_LEGGED_ORC], destinationSite: CIRITH_GORGOR }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Wizard,
            companies: opts.oppAt ? [{ site: opts.oppAt, characters: [GANDALF] }] : [],
            hand: [],
            siteDeck: [],
          },
        ],
      });
      const withState: GameState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0, maxRegionDistance: 1 }) };
      return opts.marked ? markEvilHourCompany(withState, RESOURCE_PLAYER) : withState;
    }

    test('control: at a 1-region cap the 2-region move is refused with no grant', () => {
      const state = revealState({ marked: false, oppAt: CIRITH_GORGOR });
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(false);
    });

    test('moving TO an opponent-occupied destination: the +2 grant offers the move', () => {
      const state = revealState({ marked: true, oppAt: CIRITH_GORGOR });
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(true);
    });

    test('leaving an opponent-occupied origin: the +2 grant offers the move', () => {
      // Opponent sits at Barad-dûr (the origin the company is leaving).
      const state = revealState({ marked: true, oppAt: BARAD_DUR });
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(true);
    });

    test('marked but no opponent company at either endpoint: no bonus', () => {
      const state = revealState({ marked: true }); // opponent has no companies
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(false);
    });
  });
});
