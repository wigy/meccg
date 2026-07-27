/**
 * @module as-11.test
 *
 * Card test: Gandalf the White Rider (as-11)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Maia.
 * Manifestation of Gandalf (tw-156, via `manifestId`).
 * Base creature stats: two strikes, prowess 13, body 9, kill MP 6*.
 * Canonical playable cost (data/cards.json AS-11): {f}{F} — a Free-domain
 * region OR a Free-hold site (different symbols are alternatives).
 *
 * Card text:
 *   "Unique. Maia. Manifestation of Gandalf. Two strikes. Detainment and -3
 *    prowess against hero companies. Discard this card if Gandalf comes into
 *    play. As a creature, may also be played keyed to Arthedain, The Shire,
 *    Rhudaur, Lindon, Wold & Foothills, or Anfalas; or at sites in these
 *    regions. As a permanent-event, the hazard limit against all overt minion
 *    companies is increased by one. Discard when any play deck is exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                         | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Two strikes / prowess 13 creature combat                     | IMPLEMENTED |
 * | 2 | Detainment against hero companies (not minion)               | IMPLEMENTED |
 * | 3 | -3 prowess against hero companies (13 → 10; 13 vs minion)    | IMPLEMENTED |
 * | 4 | Base keying {f} Free-domain / {F} Free-hold                  | IMPLEMENTED |
 * | 5 | Alt keying: the six named regions; or at sites in them        | IMPLEMENTED |
 * | 6 | Permanent-event mode: enters play, stays (no tap conversion)  | IMPLEMENTED |
 * | 7 | +1 hazard limit vs overt minion companies (moving or not)     | IMPLEMENTED |
 * | 8 | Covert minion / hero companies are unaffected                 | IMPLEMENTED |
 * | 9 | Discard this card if Gandalf comes into play                  | IMPLEMENTED |
 * |10 | Gandalf stays playable while the White Rider is in play       | IMPLEMENTED |
 * |11 | Manifestation of Gandalf — unplayable while Gandalf is in play| IMPLEMENTED |
 * |12 | Discard when any play deck is exhausted                       | IMPLEMENTED |
 * |13 | Unique — a second copy is unplayable while one is in play     | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2 shape),
 * creature-alt-event (permanent-event, persistent — as-13 shape),
 * combat-detainment (hero / covert fallen-wizard defenders), stat-modifier
 * prowess -3 vs hero (as-8 shape), discard-self-when
 * `charactersInPlayAnywhere: "Gandalf"`, hazard-limit-environment
 * (+1, appliesTo "all", overt Ringwraith companies), on-event
 * play-deck-exhausted self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  GANDALF, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  makeMHState, addCardInPlay,
  playCreatureHazardAndResolve,
  handCardId, findHandCardId, companyIdAt,
  viableActions, nonViableOfType, dispatch, resolveChain, reduce,
  expectInDiscardPile,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, GameState, MovementHazardPhaseState,
  EndOfTurnPhaseState, PlayCharacterAction,
} from '../../index.js';

const WHITE_RIDER = 'as-11' as CardDefinitionId;

/** Minion characters — Men are covert, Orcs make a company overt. */
const THE_MOUTH = 'le-24' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const LAYOS = 'le-19' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

/** Minion sites. */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

/** Filler card so an "exhausted" play deck still has a discard pile. */
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;

const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

/** {f} arm only: a Free-domain region outside the six named ones. */
const freeRegionPath = () => makeMHState({
  resolvedSitePath: [RegionType.Free],
  resolvedSitePathNames: ['Lebennin'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Tolfalas',
});

/** {F} arm only: a Free-hold reached through an unnamed Wilderness. */
const freeHoldPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['High Pass'],
  destinationSiteType: SiteType.FreeHold,
  destinationSiteName: "Eagles' Eyrie",
});

/** Alt arm only: a named Wilderness region crossed on the way. */
const rhudaurPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Rhudaur'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Ettenmoors',
});

/** Alt arm only, "or at sites in these regions": the destination's own region. */
const arthedainSitePath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Arthedain'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'The White Towers',
});

/** No arm matches: shadow-land path to a shadow-hold, no named region. */
const shadowPath = () => makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Minas Morgul',
});

const whiteRiderInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: WHITE_RIDER,
  status: CardStatus.Untapped,
});

/**
 * M/H fixture: the White Rider in P2's hand as the hazard player, P1's single
 * company moving with the given phase state and alignment/character.
 */
const readyState = (
  alignment: Alignment,
  characterId: CardDefinitionId,
  phaseState = freeRegionPath(),
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
        hand: [WHITE_RIDER],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/** The keying methods/values offered for the White Rider in a given fixture. */
const keyingsOffered = (state: GameState): string[] =>
  viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined)
    .map(k => `${k.method}:${k.value}`);

/**
 * Minion P1 hazard-limit snapshot: a P1 Ringwraith company of `characters`
 * (moving to Moria unless `moving: false`) has its hazard limit snapshotted at
 * site revelation; returns the resulting limit. The hero opponent P2 holds any
 * `hazardInPlay` cards — the White Rider is a hazard, so its controller is the
 * non-active player here.
 */
const minionHazardLimit = (
  characters: CardDefinitionId[],
  opts?: { moving?: boolean; hazardInPlay?: CardInPlay[] },
): number => {
  const moving = opts?.moving ?? true;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters, ...(moving ? { destinationSite: MORIA_MINION } : {}) }],
        hand: [],
        siteDeck: [MORIA_MINION],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        cardsInPlay: opts?.hazardInPlay ?? [],
      },
    ],
  });
  const ready = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0 }) };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
};

/** Hero P1 hazard-limit snapshot with the same in-play White Rider setup. */
const heroHazardLimit = (
  characters: CardDefinitionId[],
  opts?: { hazardInPlay?: CardInPlay[] },
): number => {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters, destinationSite: MINAS_TIRITH }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [BARAD_DUR],
        cardsInPlay: opts?.hazardInPlay ?? [],
      },
    ],
  });
  const ready = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0 }) };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
};

/**
 * Organization-phase fixture: hero P1 at Rivendell (a Haven — Gandalf's
 * homesite is "Any Haven") with Gandalf in hand, minion P2 holding the given
 * in-play cards.
 */
const gandalfPlayState = (hazardInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [GANDALF],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        cardsInPlay: hazardInPlay,
      },
    ],
  });

/** End-of-turn reset-hand state with the White Rider in P2's cardsInPlay. */
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
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [], siteDeck: [BARAD_DUR],
        ...(exhaustingPlayer === 0 ? emptyDeckSide : {}),
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [], siteDeck: [MINAS_TIRITH],
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
  return addCardInPlay(resetHandState, HAZARD_PLAYER, WHITE_RIDER);
};

describe('Gandalf the White Rider (as-11)', () => {
  beforeEach(() => resetMint());

  // ─── #4: base keying {f}{F} — the two arms are alternatives ───────────────

  test('keyable to a Free-domain region ({f} arm of {f}{F})', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, freeRegionPath())))
      .toContain('region-type:free');
  });

  test('keyable at a Free-hold site ({F} arm of {f}{F})', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, freeHoldPath()));
    expect(offered).toContain('site-type:free-hold');
    // The path is a plain Wilderness, so the {f} arm cannot be what matched.
    expect(offered).not.toContain('region-type:free');
  });

  // ─── #5: alt keying — the six named regions, and sites in them ────────────

  test('keyable to Rhudaur by region name (alternative keying)', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, rhudaurPath()));
    expect(offered).toContain('region-name:Rhudaur');
    // Neither base arm applies: Rhudaur is a Wilderness and the destination is
    // a Ruins & Lairs — so the region-name arm is doing the work on its own.
    expect(offered).not.toContain('region-type:free');
    expect(offered).not.toContain('site-type:free-hold');
  });

  test('keyable at a site in Arthedain ("or at sites in these regions")', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, arthedainSitePath())))
      .toContain('region-name:Arthedain');
  });

  test('not keyable on a Shadow-land path to a Shadow-hold', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, shadowPath()))).toHaveLength(0);
  });

  // ─── #1/#2/#3: two strikes at 13; -3 and detainment vs hero only ──────────

  test('attack on a hero company: 2 strikes, prowess 13-3 = 10, detainment', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: full prowess 13, no detainment', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #6: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH, shadowPath());
    const riderId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    expect(viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event')).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: riderId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === riderId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    // …and a forged tap action is rejected, leaving him in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: riderId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === riderId)).toBe(true);
  });

  // ─── #7/#8: hazard limit +1 against overt minion companies only ───────────

  test('a moving overt minion company (Orcs) has its hazard limit raised by one', () => {
    const overt = [THE_MOUTH, GORBAG, SHAGRAT];
    expect(minionHazardLimit(overt)).toBe(3);
    expect(minionHazardLimit(overt, { hazardInPlay: [whiteRiderInPlay()] })).toBe(4);
  });

  test('a covert minion company (all Men) is unaffected', () => {
    const covert = [THE_MOUTH, ASTERNAK, LAYOS];
    expect(minionHazardLimit(covert)).toBe(3);
    expect(minionHazardLimit(covert, { hazardInPlay: [whiteRiderInPlay()] })).toBe(3);
  });

  test('reaches a stationary overt minion company too ("all overt minion companies")', () => {
    const overt = [THE_MOUTH, GORBAG, SHAGRAT];
    expect(minionHazardLimit(overt, { moving: false })).toBe(3);
    expect(minionHazardLimit(overt, { moving: false, hazardInPlay: [whiteRiderInPlay()] })).toBe(4);
  });

  test('a hero company is unaffected — the rule names minion companies only', () => {
    const heroes = [ARAGORN, LEGOLAS, GANDALF];
    expect(heroHazardLimit(heroes)).toBe(3);
    expect(heroHazardLimit(heroes, { hazardInPlay: [whiteRiderInPlay()] })).toBe(3);
  });

  // ─── #9/#10: "Discard this card if Gandalf comes into play" ───────────────

  test('Gandalf is still playable while the White Rider is in play as a permanent-event', () => {
    // Control: with nothing in play, the hero player may bring Gandalf in at
    // Rivendell (his homesite is "Any Haven").
    expect(viableActions(gandalfPlayState([]), PLAYER_1, 'play-character').length)
      .toBeGreaterThanOrEqual(1);

    // g.man.1's "unless the current manifestation would leave play" clause: the
    // White Rider discards itself when Gandalf arrives, so it does not block.
    const withRider = gandalfPlayState([whiteRiderInPlay()]);
    const plays = viableActions(withRider, PLAYER_1, 'play-character');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    expect(nonViableOfType(computeLegalActions(withRider, PLAYER_1), 'play-character')
      .some(a => (a.reason ?? '').includes('manifestation'))).toBe(false);
  });

  test('playing Gandalf discards the in-play White Rider', () => {
    const withRider = gandalfPlayState([whiteRiderInPlay()]);
    const gandalfId = findHandCardId(withRider, RESOURCE_PLAYER, GANDALF);
    const play = viableActions(withRider, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .find(a => a.characterInstanceId === gandalfId);
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(withRider, play!));
    expect(Object.values(after.players[RESOURCE_PLAYER].characters)
      .some(c => c.definitionId === GANDALF)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === WHITE_RIDER)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, WHITE_RIDER);
  });

  // ─── #11: manifestation of Gandalf — blocked while Gandalf is in play ─────

  test('not playable in either mode while the character Gandalf is in play', () => {
    const withGandalf = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GANDALF] }],
          hand: [WHITE_RIDER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withGandalf, phaseState: freeRegionPath() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #12: discard when ANY play deck is exhausted ─────────────────────────

  test("discards when the opponent's (minion) play deck exhausts", () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play until the exhaust completes.
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === WHITE_RIDER)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === WHITE_RIDER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, WHITE_RIDER);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === WHITE_RIDER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, WHITE_RIDER);
  });

  // ─── #13: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, THE_MOUTH, freeRegionPath());
    const withRiderInPlay = addCardInPlay(base, HAZARD_PLAYER, WHITE_RIDER);

    expect(viableActions(withRiderInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withRiderInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
