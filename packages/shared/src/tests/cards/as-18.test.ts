/**
 * @module as-18.test
 *
 * Card test: Radagast the Tamer (as-18)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Maia.
 * Manifestation of Radagast (tw-178, via `manifestId`).
 * Base creature stats: two strikes, prowess 13, body 9, kill MP 6*.
 * Canonical playable cost (data/cards.json AS-18): {f}{F} — a Free-domain
 * region OR a Free-hold site (different symbols are alternatives).
 *
 * Card text:
 *   "Unique. Maia. Manifestation of Radagast. Two strikes. Detainment and -3
 *    prowess against hero companies. Discard this card if Radagast comes into
 *    play. As a creature, may also be played keyed to Southern Mirkwood,
 *    Western Mirkwood, Woodland Realm, Heart of Mirkwood, or Rhosgobel. As a
 *    permanent-event, all companies moving in Southern Mirkwood, Western
 *    Mirkwood, Woodland Realm, and/or Heart of Mirkwood have their hazard
 *    limit increased by one. Discard when any play deck is exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Two strikes / prowess 13 creature combat                      | IMPLEMENTED |
 * | 2 | Detainment against hero companies (not minion)                | IMPLEMENTED |
 * | 3 | -3 prowess against hero companies (13 → 10; 13 vs minion)     | IMPLEMENTED |
 * | 4 | Base keying {f} Free-domain / {F} Free-hold                   | IMPLEMENTED |
 * | 5 | Alt keying: the four named Mirkwood regions                    | IMPLEMENTED |
 * | 6 | Alt keying: the site Rhosgobel (by name, any printing)         | IMPLEMENTED |
 * | 7 | Permanent-event mode: enters play, stays (no tap conversion)   | IMPLEMENTED |
 * | 8 | +1 hazard limit for companies moving in the four regions       | IMPLEMENTED |
 * | 9 | Companies moving elsewhere / not moving are unaffected         | IMPLEMENTED |
 * |10 | Discard this card if Radagast comes into play                  | IMPLEMENTED |
 * |11 | Manifestation of Radagast — unplayable while Radagast in play  | IMPLEMENTED |
 * |12 | Discard when any play deck is exhausted                        | IMPLEMENTED |
 * |13 | Unique — a second copy is unplayable while one is in play      | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2 shape),
 * creature-alt-event (permanent-event, persistent — as-13 shape),
 * combat-detainment (hero / covert fallen-wizard defenders), stat-modifier
 * prowess -3 vs hero (as-11 shape), discard-self-when
 * `charactersInPlayAnywhere: "Radagast"`, hazard-limit-environment (+1, the
 * default `appliesTo: "moving"`, gated on `company.regionNames` — the new
 * region-name path on the per-company hazard context), on-event
 * play-deck-exhausted self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
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

const THE_TAMER = 'as-18' as CardDefinitionId;

/** The hero Wizard this card is a manifestation of. */
const RADAGAST = 'tw-178' as CardDefinitionId;

/** Minion characters — Men are covert, Orcs make a company overt. */
const THE_MOUTH = 'le-24' as CardDefinitionId;

/** Minion sites. */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;

/** Hero sites in / beyond the four Mirkwood regions. */
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;

/** Filler card so an "exhausted" play deck still has a discard pile. */
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;

const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

/** {f} arm only: a Free-domain region outside the four named ones. */
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

/**
 * Alt region-name arms, one per named region. Each uses that region's own
 * type and a destination whose type is not a Free-hold, so neither base arm
 * of {f}{F} can be what matched.
 */
const mirkwoodPaths: { region: string; state: () => MovementHazardPhaseState }[] = [
  {
    region: 'Southern Mirkwood',
    state: () => makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Southern Mirkwood'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    }),
  },
  {
    region: 'Western Mirkwood',
    state: () => makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Western Mirkwood'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Woodmen-town',
    }),
  },
  {
    region: 'Woodland Realm',
    state: () => makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Woodland Realm'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Sarn Goriwing',
    }),
  },
  {
    region: 'Heart of Mirkwood',
    state: () => makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Heart of Mirkwood'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Sarn Goriwing',
    }),
  },
];

/**
 * The "or Rhosgobel" arm: a company moving to the Fallen-wizard printing of
 * Rhosgobel (wh-57), which is a *Haven* — no site-type arm of the card can
 * reach it, so the site-name arm is what opens the attack up.
 */
const rhosgobelHavenPath = () => makeMHState({
  resolvedSitePath: [RegionType.Dark],
  resolvedSitePathNames: ['Southern Mirkwood'],
  destinationSiteType: SiteType.Haven,
  destinationSiteName: 'Rhosgobel',
});

/** Control for the arm above: another Haven in the same region is NOT named. */
const otherHavenPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['High Pass'],
  destinationSiteType: SiteType.Haven,
  destinationSiteName: 'Rivendell',
});

/** No arm matches: shadow-land path to a shadow-hold, no named region. */
const shadowPath = () => makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Minas Morgul',
});

const tamerInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: THE_TAMER,
  status: CardStatus.Untapped,
});

/**
 * M/H fixture: the Tamer in P2's hand as the hazard player, P1's single
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
        hand: [THE_TAMER],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/** The keying methods/values offered for the Tamer in a given fixture. */
const keyingsOffered = (state: GameState): string[] =>
  viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined)
    .map(k => `${k.method}:${k.value}`);

/**
 * Hero P1 hazard-limit snapshot: a P1 company of Aragorn/Legolas moving to
 * Woodmen-town along `pathNames` (or standing still when `moving: false`) has
 * its hazard limit snapshotted at site revelation; returns the locked-in
 * limit. The minion opponent P2 holds any `hazardInPlay` cards — the Tamer is
 * a hazard, so its controller is the non-active player here.
 */
const heroHazardLimit = (
  pathNames: string[],
  opts?: { moving?: boolean; hazardInPlay?: CardInPlay[] },
): number => {
  const moving = opts?.moving ?? true;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: RIVENDELL,
          characters: [ARAGORN, LEGOLAS],
          ...(moving ? { destinationSite: WOODMEN_TOWN } : {}),
        }],
        hand: [],
        siteDeck: [WOODMEN_TOWN],
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
  const ready = {
    ...state,
    phaseState: makeMHState({
      step: 'set-hazard-limit',
      activeCompanyIndex: 0,
      resolvedSitePath: moving ? [RegionType.Wilderness] : [],
      resolvedSitePathNames: moving ? pathNames : [],
      destinationSiteType: moving ? SiteType.BorderHold : null,
      destinationSiteName: moving ? 'Woodmen-town' : null,
    }),
  };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
};

/**
 * Minion P1 hazard-limit snapshot along the same lines — "all companies", so
 * the minion side is reached too. The hero opponent P2 holds the in-play cards.
 */
const minionHazardLimit = (
  pathNames: string[],
  opts?: { hazardInPlay?: CardInPlay[] },
): number => {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH], destinationSite: MINAS_MORGUL }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: opts?.hazardInPlay ?? [],
      },
    ],
  });
  const ready = {
    ...state,
    phaseState: makeMHState({
      step: 'set-hazard-limit',
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: pathNames,
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Minas Morgul',
    }),
  };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
};

/**
 * Organization-phase fixture: hero P1 at Rivendell (a Wizard avatar may be
 * revealed at Rivendell or at his home site) with Radagast in hand, minion P2
 * holding the given in-play cards.
 */
const radagastPlayState = (hazardInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [RADAGAST],
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

/** End-of-turn reset-hand state with the Tamer in P2's cardsInPlay. */
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
  return addCardInPlay(resetHandState, HAZARD_PLAYER, THE_TAMER);
};

describe('Radagast the Tamer (as-18)', () => {
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

  // ─── #5: alt keying — the four named Mirkwood regions ─────────────────────

  for (const { region, state } of mirkwoodPaths) {
    test(`keyable to ${region} by region name (alternative keying)`, () => {
      const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, state()));
      expect(offered).toContain(`region-name:${region}`);
      // Neither base arm applies here, so the region-name arm does the work.
      expect(offered).not.toContain('region-type:free');
      expect(offered).not.toContain('site-type:free-hold');
    });
  }

  // ─── #6: alt keying — the named site Rhosgobel ────────────────────────────

  test('keyable at Rhosgobel by site name, even the Haven printing (wh-57)', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, rhosgobelHavenPath()));
    expect(offered).toContain('site-name:Rhosgobel');
    // A Haven matches no site-type arm of this card.
    expect(offered).not.toContain('site-type:free-hold');
    expect(offered).not.toContain('site-type:haven');
  });

  test('a different Haven is not covered by the site-name arm', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, otherHavenPath())))
      .toHaveLength(0);
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

  // ─── #7: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH, shadowPath());
    const tamerId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    expect(viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event')).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: tamerId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === tamerId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    // …and a forged tap action is rejected, leaving him in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: tamerId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === tamerId)).toBe(true);
  });

  // ─── #8/#9: +1 hazard limit for companies moving in the four regions ──────

  for (const { region } of mirkwoodPaths) {
    test(`a company moving in ${region} has its hazard limit raised by one`, () => {
      expect(heroHazardLimit([region])).toBe(2);
      expect(heroHazardLimit([region], { hazardInPlay: [tamerInPlay()] })).toBe(3);
    });
  }

  test('a multi-region path containing one named region still counts', () => {
    const path = ['High Pass', 'Heart of Mirkwood', 'Wold & Foothills'];
    expect(heroHazardLimit(path)).toBe(2);
    expect(heroHazardLimit(path, { hazardInPlay: [tamerInPlay()] })).toBe(3);
  });

  test('a company moving elsewhere is unaffected', () => {
    expect(heroHazardLimit(['High Pass'])).toBe(2);
    expect(heroHazardLimit(['High Pass'], { hazardInPlay: [tamerInPlay()] })).toBe(2);
  });

  test('a stationary company is unaffected ("companies moving in")', () => {
    expect(heroHazardLimit(['Southern Mirkwood'], { moving: false })).toBe(2);
    expect(heroHazardLimit(['Southern Mirkwood'], { moving: false, hazardInPlay: [tamerInPlay()] }))
      .toBe(2);
  });

  test('"all companies" reaches the minion side too', () => {
    expect(minionHazardLimit(['Southern Mirkwood'])).toBe(2);
    expect(minionHazardLimit(['Southern Mirkwood'], { hazardInPlay: [tamerInPlay()] })).toBe(3);
    expect(minionHazardLimit(['Imlad Morgul'], { hazardInPlay: [tamerInPlay()] })).toBe(2);
  });

  // ─── #10: "Discard this card if Radagast comes into play" ─────────────────

  test('Radagast is still playable while the Tamer is in play as a permanent-event', () => {
    // Control: with nothing in play, the hero player may reveal Radagast at
    // Rivendell (the Wizard-avatar haven).
    expect(viableActions(radagastPlayState([]), PLAYER_1, 'play-character').length)
      .toBeGreaterThanOrEqual(1);

    // g.man.1's "unless the current manifestation would leave play" clause: the
    // Tamer discards himself when Radagast arrives, so he does not block.
    const withTamer = radagastPlayState([tamerInPlay()]);
    expect(viableActions(withTamer, PLAYER_1, 'play-character').length).toBeGreaterThanOrEqual(1);
    expect(nonViableOfType(computeLegalActions(withTamer, PLAYER_1), 'play-character')
      .some(a => (a.reason ?? '').includes('manifestation'))).toBe(false);
  });

  test('playing Radagast discards the in-play Tamer', () => {
    const withTamer = radagastPlayState([tamerInPlay()]);
    const radagastId = findHandCardId(withTamer, RESOURCE_PLAYER, RADAGAST);
    const play = viableActions(withTamer, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .find(a => a.characterInstanceId === radagastId);
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(withTamer, play!));
    expect(Object.values(after.players[RESOURCE_PLAYER].characters)
      .some(c => c.definitionId === RADAGAST)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_TAMER)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, THE_TAMER);
  });

  // ─── #11: manifestation of Radagast — blocked while Radagast is in play ───

  test('not playable in either mode while the character Radagast is in play', () => {
    const withRadagast = buildTestState({
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
          companies: [{ site: LORIEN, characters: [RADAGAST] }],
          hand: [THE_TAMER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withRadagast, phaseState: freeRegionPath() };

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
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_TAMER)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_TAMER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, THE_TAMER);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_TAMER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, THE_TAMER);
  });

  // ─── #13: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, THE_MOUTH, freeRegionPath());
    const withTamerInPlay = addCardInPlay(base, HAZARD_PLAYER, THE_TAMER);

    expect(viableActions(withTamerInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withTamerInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
