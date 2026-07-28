/**
 * @module as-16.test
 *
 * Card test: Master of the House (as-16)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Elf.
 * Manifestation of Elrond (tw-145, via `manifestId`).
 * Base creature stats: one strike, prowess 14, body 9, kill MP 3*.
 *
 * Card text:
 *   "Unique. Elf. Manifestation of Elrond. One strike. Detainment against hero
 *    companies. As a creature, may be played keyed to Rhudaur, Arthedain, High
 *    Pass, The Shire, or Cardolan; or at sites in these regions. As a
 *    permanent-event, each player at the end of each turn may bring one Elf
 *    creature from his discard pile to his hand. Discard when any play deck is
 *    exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Manifestation of Elrond — g.man.1 both directions              | IMPLEMENTED |
 * | 2 | One strike / prowess 14 creature combat                       | IMPLEMENTED |
 * | 3 | Detainment against hero companies (not minion)                 | IMPLEMENTED |
 * | 4 | Keyed to the five named regions                                | IMPLEMENTED |
 * | 5 | "or at sites in these regions" (destination site's own region) | IMPLEMENTED |
 * | 6 | Permanent-event mode: enters play, stays (no tap conversion)   | IMPLEMENTED |
 * | 7 | Each player may recall one Elf creature discard→hand at EOT    | IMPLEMENTED |
 * | 8 | Only Elf *creatures* qualify (not Man creatures / Elf chars)   | IMPLEMENTED |
 * | 9 | The recall is optional ("may") — a player can decline          | IMPLEMENTED |
 * |10 | Discard when any play deck is exhausted                        | IMPLEMENTED |
 * |11 | Unique — a second copy is unplayable while one is in play      | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2
 * precedent), creature-alt-event (permanent-event, persistent — as-13/as-14
 * shape), combat-detainment (hero / covert fallen-wizard defenders, as-8/as-21
 * shape), an `on-event: end-of-turn` with `actor: "both"` whose apply is a
 * `move` `{ select: target, from: discard, to: hand, count: 1 }` filtered to
 * `cardType: hazard-creature, race: elf` (the le-142 "each player at the end of
 * each turn" shape with td-27's `to: "hand"` destination), and an `on-event
 * play-deck-exhausted` self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeSitePhase,
  playCreatureHazardAndResolve,
  addCardInPlay,
  handCardId, companyIdAt,
  viableActions, nonViableOfType, dispatch, dispatchResult, resolveChain, reduce,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, GameState,
  MovementHazardPhaseState, EndOfTurnPhaseState, FetchFromPileAction,
} from '../../index.js';

const MASTER = 'as-16' as CardDefinitionId;

// Elf hazard creatures — the recall targets. Both are non-unique, so a test may
// seed several copies into a discard pile.
const WANDERING_ELDAR = 'le-97' as CardDefinitionId;
const GALADHRIM = 'as-10' as CardDefinitionId;
// Non-matching discard fodder: a Man hazard creature and a plain hazard event.
const RUFFIANS = 'tw-8' as CardDefinitionId;
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;

// Minion fixtures, for the "no detainment against minion companies" arm.
const MIONID = 'as-3' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** The five regions the creature mode may be keyed to. */
const KEYED_REGIONS = ['Rhudaur', 'Arthedain', 'High Pass', 'The Shire', 'Cardolan'];

/** An M/H state whose resolved site path crosses the named region. */
const pathThrough = (regionName: string): MovementHazardPhaseState => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: [regionName],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Goblin-gate',
});

/**
 * M/H fixture: the Master in P2's hand as the hazard player, P1's single
 * company moving with the given phase state and alignment/character.
 */
const readyState = (
  alignment: Alignment,
  characterId: CardDefinitionId,
  phaseState = pathThrough('Rhudaur'),
): GameState => {
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
        hand: [MASTER],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/**
 * Site-phase fixture poised one `pass` away from the end-of-turn transition,
 * with the Master in the hazard player's `cardsInPlay` as a permanent-event and
 * the given cards seeded into each player's discard pile.
 */
const eotFetchState = (
  p1Discard: readonly CardDefinitionId[],
  p2Discard: readonly CardDefinitionId[],
  masterInPlay = true,
): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        discardPile: [...p1Discard],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        discardPile: [...p2Discard],
      },
    ],
  });
  const withMaster = masterInPlay ? addCardInPlay(base, HAZARD_PLAYER, MASTER) : base;
  return {
    ...withMaster,
    phaseState: makeSitePhase({
      step: 'play-resources',
      handledCompanyIds: [],
      activeCompanyIndex: 0,
      siteEntered: true,
    }),
  };
};

/** End-of-turn reset-hand state with the Master in P2's `cardsInPlay`. */
const exhaustState = (exhaustingPlayer: 0 | 1): GameState => {
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
  return addCardInPlay(resetHandState, 1, MASTER);
};

describe('Master of the House (as-16)', () => {
  beforeEach(() => resetMint());

  // ─── #4: creature keying — five named regions ─────────────────────────────

  for (const region of KEYED_REGIONS) {
    test(`keyable by region name to ${region}`, () => {
      const ready = readyState(Alignment.Wizard, ARAGORN, pathThrough(region));
      const plays = viableActions(ready, PLAYER_2, 'play-hazard');
      expect(plays.some(p => {
        const a = p.action as { keyedBy?: { method: string; value: string } };
        return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
      })).toBe(true);
    });
  }

  test('not keyable as a creature on a path that avoids all five regions', () => {
    // A generic wilderness is NOT enough — the keying is by region name only.
    const ready = readyState(Alignment.Wizard, ARAGORN, pathThrough('Anduin Vales'));
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => (p.action as { keyedBy?: unknown }).keyedBy !== undefined)).toBe(false);
  });

  // ─── #5: "or at sites in these regions" ───────────────────────────────────

  test('keyable at a site in one of the regions even with no other region crossed', () => {
    // Barrow-downs (tw-375) sits in Cardolan; a company arriving there has only
    // 'Cardolan' in its resolved path names.
    const ready = readyState(Alignment.Wizard, ARAGORN, makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Cardolan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Barrow-downs',
    }));
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Cardolan';
    })).toBe(true);
  });

  // ─── #2/#3: one strike at prowess 14; detainment vs hero, not vs minion ───

  test('attack on a hero company: 1 strike at prowess 14, detainment', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, {
      method: 'region-name', value: 'Rhudaur',
    });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(14);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: normal attack (no detainment)', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, {
      method: 'region-name', value: 'Rhudaur',
    });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(14);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #6: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID, pathThrough('Anduin Vales'));
    const masterId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: masterId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[1].cardsInPlay.find(c => c.instanceId === masterId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent (as-13 shape): no Nazgûl-style tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);

    // …and a forged tap action is rejected, leaving the Master in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: masterId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[1].cardsInPlay.some(c => c.instanceId === masterId)).toBe(true);
  });

  // ─── #7: each player may recall one Elf creature from discard to hand ─────

  test('entering end-of-turn queues one recall for EACH player', () => {
    const state = eotFetchState([WANDERING_ELDAR], [GALADHRIM]);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
    expect(afterPass.pendingEffects).toHaveLength(2);
    expect(afterPass.pendingEffects.map(e => e.actor)).toEqual(
      expect.arrayContaining([PLAYER_1, PLAYER_2]),
    );
    for (const pe of afterPass.pendingEffects) {
      expect(pe.type).toBe('card-effect');
      if (pe.type === 'card-effect') {
        expect(pe.effect.type).toBe('fetch-to-deck');
        if (pe.effect.type === 'fetch-to-deck') {
          // The destination is the HAND, not the play deck.
          expect(pe.effect.to).toBe('hand');
          expect(pe.effect.count).toBe(1);
          expect(pe.effect.source).toEqual(['discard-pile']);
        }
      }
    }
  });

  test('control: no recall is queued when the Master is not in play', () => {
    const state = eotFetchState([WANDERING_ELDAR], [GALADHRIM], false);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
    expect(afterPass.pendingEffects).toHaveLength(0);
  });

  test('the resource player recalls an Elf creature from his discard pile to his HAND', () => {
    const state = eotFetchState([WANDERING_ELDAR], []);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const eldar = afterPass.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === WANDERING_ELDAR,
    );
    expect(eldar).toBeDefined();

    const afterFetch = dispatch(afterPass, {
      type: 'fetch-from-pile', player: PLAYER_1,
      cardInstanceId: eldar!.instanceId, source: 'discard-pile', to: 'hand',
    });

    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === WANDERING_ELDAR)).toBe(true);
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === WANDERING_ELDAR)).toBe(false);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WANDERING_ELDAR)).toBe(false);
  });

  test('the hazard player (the Master\'s owner) recalls from his OWN discard pile', () => {
    const state = eotFetchState([], [GALADHRIM]);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // The resource player has nothing to take — decline and hand over.
    const afterDecline = dispatch(afterPass, { type: 'pass', player: PLAYER_1 });
    expect(afterDecline.pendingEffects).toHaveLength(1);
    expect(afterDecline.pendingEffects[0].actor).toBe(PLAYER_2);

    const galadhrim = afterDecline.players[HAZARD_PLAYER].discardPile.find(
      c => c.definitionId === GALADHRIM,
    );
    expect(galadhrim).toBeDefined();

    const afterFetch = dispatch(afterDecline, {
      type: 'fetch-from-pile', player: PLAYER_2,
      cardInstanceId: galadhrim!.instanceId, source: 'discard-pile', to: 'hand',
    });

    expect(afterFetch.players[HAZARD_PLAYER].hand.some(c => c.definitionId === GALADHRIM)).toBe(true);
    expect(afterFetch.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === GALADHRIM)).toBe(false);
  });

  // ─── #8: only Elf *creatures* qualify ─────────────────────────────────────

  test('only Elf hazard creatures are offered — Man creatures, events and Elf characters are not', () => {
    const state = eotFetchState([WANDERING_ELDAR, RUFFIANS, STRANGE_RATIONS, ELROND], []);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const offers = viableActions(afterPass, PLAYER_1, 'fetch-from-pile');
    expect(offers).toHaveLength(1);
    const offered = offers[0].action as FetchFromPileAction;
    expect(offered.to).toBe('hand');
    const offeredDef = afterPass.players[RESOURCE_PLAYER].discardPile.find(
      c => c.instanceId === offered.cardInstanceId,
    );
    expect(offeredDef?.definitionId).toBe(WANDERING_ELDAR);
  });

  test('one Elf creature only — a second recall is not offered after the first', () => {
    const state = eotFetchState([WANDERING_ELDAR, GALADHRIM], []);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Both Elf creatures are candidates…
    expect(viableActions(afterPass, PLAYER_1, 'fetch-from-pile')).toHaveLength(2);

    const eldar = afterPass.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === WANDERING_ELDAR,
    )!;
    const afterFetch = dispatch(afterPass, {
      type: 'fetch-from-pile', player: PLAYER_1,
      cardInstanceId: eldar.instanceId, source: 'discard-pile', to: 'hand',
    });

    // …but only one is taken: the resource player's recall is spent, and the
    // Galadhrim stays in the discard pile.
    expect(afterFetch.players[RESOURCE_PLAYER].hand.filter(
      c => c.definitionId === WANDERING_ELDAR || c.definitionId === GALADHRIM,
    )).toHaveLength(1);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GALADHRIM)).toBe(true);
    expect(afterFetch.pendingEffects.some(e => e.actor === PLAYER_1)).toBe(false);
  });

  // ─── #9: the recall is optional ("may") ───────────────────────────────────

  test('a player may decline the recall, leaving the Elf creature in his discard pile', () => {
    const state = eotFetchState([WANDERING_ELDAR], []);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Passing is always offered alongside the candidates.
    expect(viableActions(afterPass, PLAYER_1, 'pass')).toHaveLength(1);

    const result = dispatchResult(afterPass, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === WANDERING_ELDAR,
    )).toBe(true);
    expect(result.state.players[RESOURCE_PLAYER].hand.some(
      c => c.definitionId === WANDERING_ELDAR,
    )).toBe(false);
  });

  // ─── #10: discard when ANY play deck is exhausted ─────────────────────────

  test('discards when the opponent\'s (hero) play deck exhausts', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play until the exhaust completes.
    expect(afterExhaust.players[1].cardsInPlay.some(c => c.definitionId === MASTER)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === MASTER)).toBe(false);
    expectInDiscardPile(afterPass, 1, MASTER);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === MASTER)).toBe(false);
    expectInDiscardPile(afterPass, 1, MASTER);
  });

  // ─── #1: manifestation of Elrond (g.man.1, both directions) ───────────────

  test('not playable in either mode while the character Elrond is in play', () => {
    const withElrond = buildTestState({
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
          companies: [{ site: RIVENDELL, characters: [ELROND] }],
          hand: [MASTER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withElrond, phaseState: pathThrough('Rhudaur') };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  test('Elrond cannot be played while the Master is in play as a permanent-event', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ELROND], siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
      ],
    });

    // Control: with no Master in play, Elrond is playable at Lórien (a haven).
    expect(viableActions(base, PLAYER_1, 'play-character').length).toBeGreaterThanOrEqual(1);

    // With the Master in play on P2's side, g.man.1 blocks the character play.
    const withMaster = addCardInPlay(base, 1, MASTER);
    expect(viableActions(withMaster, PLAYER_1, 'play-character')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withMaster, PLAYER_1), 'play-character');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #11: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, MIONID, pathThrough('High Pass'));
    const withMasterInPlay = addCardInPlay(base, 1, MASTER);

    expect(viableActions(withMasterInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withMasterInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
