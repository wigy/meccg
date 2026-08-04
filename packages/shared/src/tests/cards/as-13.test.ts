/**
 * @module as-13.test
 *
 * Card test: Lady of the Golden Wood (as-13)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Elf.
 * Manifestation of Galadriel (tw-153, via `manifestId`).
 * Base creature stats: one strike, prowess 12, body 10, kill MP 3*.
 *
 * Card text:
 *   "Unique. Elf. Manifestation of Galadriel. One strike. Detainment against
 *    hero companies. As a creature, may be played keyed to Wold & Foothills;
 *    or at sites in this region. As a permanent-event, all effects are
 *    automatically canceled which allow a minion player to search through or
 *    look at any portion of his play deck or discard pile outside of the
 *    normal sequence of play. Discard when any play deck is exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Manifestation of Galadriel — g.man.1 both directions        | IMPLEMENTED |
 * | 2 | One strike / prowess 12 creature combat                     | IMPLEMENTED |
 * | 3 | Detainment against hero companies (not minion)              | IMPLEMENTED |
 * | 4 | Keyed to Wold & Foothills / at sites in this region         | IMPLEMENTED |
 * | 5 | Permanent-event mode: enters play, stays (no tap conversion)| IMPLEMENTED |
 * | 6 | Cancels minion play-deck / discard-pile search effects      | IMPLEMENTED |
 * | 7 | Sideboard access & hero players unaffected by the cancel    | IMPLEMENTED |
 * | 8 | Discard when any play deck is exhausted                     | IMPLEMENTED |
 * | 9 | Unique — a second copy is unplayable while one is in play   | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, shared
 * machinery certified with tw-2), creature-alt-event (permanent-event,
 * persistent), combat-detainment (hero / covert fallen-wizard defenders),
 * cancel-deck-search, on-event play-deck-exhausted self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  addCardInPlay,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions, nonViableOfType, dispatch, resolveChain, reduce,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, FetchFromPileAction, EndOfTurnPhaseState,
} from '../../index.js';

const LADY = 'as-13' as CardDefinitionId;
const GALADRIEL = 'tw-153' as CardDefinitionId;

// Minion fixtures (the Lady's cancel targets minion players).
const MIONID = 'as-3' as CardDefinitionId;           // minion-character
const THE_MOUTH = 'le-24' as CardDefinitionId;       // minion-character
const AKHORAHIL = 'le-51' as CardDefinitionId;       // Ringwraith avatar
const AKHORAHIL_UNLEASHED = 'le-162' as CardDefinitionId; // deck+discard magic tutor
const WEIGH_ALL_THINGS = 'le-253' as CardDefinitionId;    // sideboard+discard fetch
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;  // minion magic card (fetch target)
const BLACK_MACE = 'le-299' as CardDefinitionId;     // minion item (fetch target)
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven
const BARAD_DUR = 'le-352' as CardDefinitionId;      // minion dark-hold
const VARIAG_CAMP = 'le-411' as CardDefinitionId;    // minion border-hold

// Hero-side control for the deck-search cancel.
const SMOKE_RINGS = 'dm-159' as CardDefinitionId;    // hero sideboard+discard fetch
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // filler discard-pile card

const WOLD_KEYING = { method: 'region-name' as const, value: 'Wold & Foothills' };

/** An M/H state whose site path crosses Wold & Foothills (a wilderness). */
const woldPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Wold & Foothills'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Wellinghall',
});

/** A wilderness path that never touches Wold & Foothills. */
const otherPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['High Pass'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Goblin-gate',
});

/**
 * M/H fixture: the Lady in P2's hand as the hazard player, P1's single
 * company moving with the given phase state and alignment/character.
 */
function readyState(
  alignment: Alignment,
  characterId: CardDefinitionId,
  phaseState = woldPath(),
): GameState {
  const site = alignment === Alignment.Ringwraith ? DOL_GULDUR : LORIEN;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site, characters: [characterId] }],
        hand: [],
        siteDeck: [alignment === Alignment.Ringwraith ? BARAD_DUR : MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [LADY],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
}

describe('Lady of the Golden Wood (as-13)', () => {
  beforeEach(() => resetMint());

  // ─── #4: creature keying — Wold & Foothills by region name ────────────────

  test('keyable to Wold & Foothills (region name) when the path crosses it', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN, woldPath());
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Wold & Foothills';
    })).toBe(true);
  });

  test('not keyable as a creature on a path that avoids Wold & Foothills', () => {
    // A generic wilderness is NOT enough — the keying is by region name only.
    const ready = readyState(Alignment.Wizard, ARAGORN, otherPath());
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => (p.action as { keyedBy?: unknown }).keyedBy !== undefined)).toBe(false);
  });

  // ─── #2/#3: one strike at prowess 12; detainment vs hero, not vs minion ───

  test('attack on a hero company: 1 strike at prowess 12, detainment', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, WOLD_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(12);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: normal attack (no detainment)', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, WOLD_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(12);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #5: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID, otherPath());
    const ladyId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: ladyId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[1].cardsInPlay.find(c => c.instanceId === ladyId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Unlike the Nazgûl, the Lady is persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);

    // …and a forged tap action is rejected, leaving her in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: ladyId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[1].cardsInPlay.some(c => c.instanceId === ladyId)).toBe(true);
  });

  // ─── #6: cancels minion play-deck / discard-pile searches ─────────────────

  /**
   * Minion Ringwraith fixture in the long-event phase holding a search card;
   * P2 is the hero opponent whose in-play Lady (when `withLady`) cancels the
   * minion's own play-deck / discard-pile searches.
   */
  function minionSearchState(opts: {
    handCard: CardDefinitionId;
    characters?: CardDefinitionId[];
    playDeck?: CardDefinitionId[];
    discardPile?: CardDefinitionId[];
    sideboard?: CardDefinitionId[];
    withLady: boolean;
  }): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: opts.characters ?? [THE_MOUTH] }],
          hand: [opts.handCard],
          playDeck: opts.playDeck ?? [],
          discardPile: opts.discardPile ?? [],
          sideboard: opts.sideboard ?? [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }],
          hand: [], siteDeck: [RIVENDELL],
        },
      ],
    });
    return opts.withLady ? addCardInPlay(state, 1, LADY) : state;
  }

  test('minion play-deck/discard tutor (Akhôrahil Unleashed) fizzles entirely while the Lady is in play', () => {
    const state = minionSearchState({
      handCard: AKHORAHIL_UNLEASHED,
      characters: [AKHORAHIL],
      playDeck: [DEEPER_SHADOW],
      discardPile: [DEEPER_SHADOW],
      withLady: true,
    });
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
      targetCharacterId: akhId,
    }));

    // Both sources are canceled: no fetch sub-flow opens, nothing is fetched,
    // and the spent event lands in the discard pile.
    expect(next.pendingEffects).toHaveLength(0);
    expect(viableActions(next, PLAYER_1, 'fetch-from-pile')).toHaveLength(0);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discardPile.some(c => c.instanceId === eventId)).toBe(true);
  });

  test('control: without the Lady the same tutor offers deck and discard fetches', () => {
    const state = minionSearchState({
      handCard: AKHORAHIL_UNLEASHED,
      characters: [AKHORAHIL],
      playDeck: [DEEPER_SHADOW],
      discardPile: [DEEPER_SHADOW],
      withLady: false,
    });
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
      targetCharacterId: akhId,
    }));

    const sources = viableActions(next, PLAYER_1, 'fetch-from-pile')
      .map(a => (a.action as FetchFromPileAction).source);
    expect(sources).toContain('deck');
    expect(sources).toContain('discard-pile');
  });

  test('sideboard access survives: Weigh All Things loses only its discard-pile arm', () => {
    const state = minionSearchState({
      handCard: WEIGH_ALL_THINGS,
      sideboard: [BLACK_MACE],
      discardPile: [BLACK_MACE],
      withLady: true,
    });
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
    }));

    // The fetch still runs, but only from the sideboard — the discard-pile
    // source was stripped by the Lady's cancel.
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    const fetchSources = viableActions(next, PLAYER_1, 'fetch-from-pile')
      .map(a => (a.action as FetchFromPileAction).source);
    expect(fetchSources).toContain('sideboard');
    expect(fetchSources).not.toContain('discard-pile');
  });

  // ─── #7: a HERO player's own searches are unaffected ──────────────────────

  test('a hero player\'s discard-pile fetch (Smoke Rings) is NOT canceled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [SMOKE_RINGS],
          discardPile: [STRANGE_RATIONS],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const state = addCardInPlay(base, 1, LADY);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
    }));

    // The fetch sub-flow opens with the discard-pile source intact.
    expect(next.pendingEffects).toHaveLength(1);
    const effect = next.pendingEffects[0].effect as { type: string; source: readonly string[] };
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toContain('discard-pile');
  });

  // ─── #8: discard when ANY play deck is exhausted ──────────────────────────

  /** End-of-turn reset-hand state with the Lady in P1's (hero) cardsInPlay. */
  function exhaustState(exhaustingPlayer: 0 | 1): GameState {
    const emptyDeckSide = {
      playDeck: [] as CardDefinitionId[],
      discardPile: [STRANGE_RATIONS],
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [], siteDeck: [MINAS_TIRITH],
          ...(exhaustingPlayer === 0 ? emptyDeckSide : {}),
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
          hand: [], siteDeck: [BARAD_DUR],
          ...(exhaustingPlayer === 1 ? emptyDeckSide : {}),
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: (exhaustingPlayer === 0 ? [false, true] : [true, false]) as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    return addCardInPlay(resetHandState, 0, LADY);
  }

  test('discards when the opponent\'s (minion) play deck exhausts', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    // Still in play until the exhaust completes.
    expect(afterExhaust.players[0].cardsInPlay.some(c => c.definitionId === LADY)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[0].cardsInPlay.some(c => c.definitionId === LADY)).toBe(false);
    expect(afterPass.players[0].discardPile.some(c => c.definitionId === LADY)).toBe(true);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[0].cardsInPlay.some(c => c.definitionId === LADY)).toBe(false);
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    expect(afterPass.players[0].discardPile.some(c => c.definitionId === LADY)).toBe(false);
    expect(afterPass.players[0].playDeck.some(c => c.definitionId === LADY)).toBe(true);
  });

  // ─── #1: manifestation of Galadriel (g.man.1, both directions) ────────────

  test('not playable in either mode while the character Galadriel is in play', () => {
    // Galadriel sits in the hazard player's own company (g.man.1 blocks the
    // Lady regardless of which side the manifestation is on).
    const withGaladriel = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [MIONID] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GALADRIEL] }],
          hand: [LADY],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withGaladriel, phaseState: woldPath() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  test('Galadriel cannot be played while the Lady is in play as a permanent-event', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GALADRIEL], siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
      ],
    });

    // Control: with no Lady in play, Galadriel is playable at Lórien (her
    // homesite and a haven).
    expect(viableActions(base, PLAYER_1, 'play-character').length).toBeGreaterThanOrEqual(1);

    // With the Lady in play (P2's side — g.man.1 applies across players),
    // the character play is blocked.
    const withLady = addCardInPlay(base, 1, LADY);
    expect(viableActions(withLady, PLAYER_1, 'play-character')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withLady, PLAYER_1), 'play-character');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #9: unique — no second play while one copy is in play ────────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, MIONID, woldPath());
    const withLadyInPlay = addCardInPlay(base, 1, LADY);

    expect(viableActions(withLadyInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withLadyInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
