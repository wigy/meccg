/**
 * @module as-19.test
 *
 * Card test: Saruman the Wise (as-19)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Maia.
 * Manifestation of Saruman (tw-181, via `manifestId`).
 * Base creature stats: three strikes, prowess 13, body 9, kill MP 6*.
 * Canonical playable cost (data/cards.json AS-19): {f}{F} — a Free-domain
 * region OR a Free-hold site (different symbols are alternatives).
 *
 * Card text:
 *   "Unique. Maia. Manifestation of Saruman. Three strikes. Detainment and -3
 *    prowess against hero companies. Discard this card if Saruman comes into
 *    play. As a creature, may also be played keyed to Gap of Isen, Rohan,
 *    Enedhwaith, or Old Pûkel-land; or at sites in these regions. As a
 *    permanent-event, all ring items give one additional corruption point.
 *    Discard when any play deck is exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Three strikes / prowess 13 creature combat                    | IMPLEMENTED |
 * | 2 | Detainment against hero companies (not minion)                | IMPLEMENTED |
 * | 3 | -3 prowess against hero companies (13 → 10; 13 vs minion)     | IMPLEMENTED |
 * | 4 | Base keying {f} Free-domain / {F} Free-hold                   | IMPLEMENTED |
 * | 5 | Alt keying: the four named regions; or at sites in them        | IMPLEMENTED |
 * | 6 | Permanent-event mode: enters play, stays (no tap conversion)   | IMPLEMENTED |
 * | 7 | Ring items give +1 corruption point while he is in play        | IMPLEMENTED |
 * | 8 | Only corruption — a ring item's marshalling points are untouched| IMPLEMENTED |
 * | 9 | Non-ring items are unaffected                                  | IMPLEMENTED |
 * |10 | "All ring items" — both players' rings are hit                 | IMPLEMENTED |
 * |11 | Discard this card if Saruman comes into play                   | IMPLEMENTED |
 * |12 | Saruman stays playable while Saruman the Wise is in play        | IMPLEMENTED |
 * |13 | Manifestation of Saruman — unplayable while Saruman is in play  | IMPLEMENTED |
 * |14 | Discard when any play deck is exhausted                        | IMPLEMENTED |
 * |15 | Unique — a second copy is unplayable while one is in play       | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight),
 * creature-alt-event (permanent-event, persistent — as-13 shape),
 * combat-detainment (hero / covert fallen-wizard defenders), stat-modifier
 * prowess -3 vs hero (as-11 shape), discard-self-when
 * `charactersInPlayAnywhere: "Saruman"`, in-play-item-modifier
 * (`item.keywords $includes ring`, corruptionPoints +1 — le-224 shape),
 * on-event play-deck-exhausted self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, SARUMAN, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MINAS_TIRITH, ISENGARD, MORIA,
  buildTestState, resetMint, mint, recomputeDerived,
  makeMHState, addCardInPlay, attachItemToChar,
  playCreatureHazardAndResolve,
  charIdAt, handCardId, findHandCardId, companyIdAt,
  viableActions, viablePlayCharacterActions, nonViableOfType,
  dispatch, resolveChain, reduce, expectInDiscardPile,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, GameState, EndOfTurnPhaseState, PlayCharacterAction,
} from '../../index.js';

const SARUMAN_THE_WISE = 'as-19' as CardDefinitionId;

/** Minion characters and sites for the non-hero fixtures. */
const THE_MOUTH = 'le-24' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL_MINION = 'le-390' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;

/** Items: a minion ring, and a hero non-ring control item. */
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // minion ring, cp 4 / 2 MP
const ELVEN_CLOAK = 'tw-225' as CardDefinitionId;         // hero minor item, cp 1, no keywords

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

/** Alt arm only: a named Wilderness region crossed on the way. */
const enedhwaithPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
  resolvedSitePathNames: ['Enedhwaith'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Ruined Signal Tower',
});

/** Alt arm only, "or at sites in these regions": Isengard sits in Gap of Isen. */
const gapOfIsenSitePath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Border],
  resolvedSitePathNames: ['Gap of Isen'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Isengard',
});

/** No arm matches: shadow-land path to a shadow-hold, no named region. */
const shadowPath = () => makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Shelob’s Lair',
});

const wiseInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: SARUMAN_THE_WISE,
  status: CardStatus.Untapped,
});

/**
 * M/H fixture: Saruman the Wise in P2's hand as the hazard player, P1's single
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
        hand: [SARUMAN_THE_WISE],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/** The keying methods/values offered for Saruman the Wise in a given fixture. */
const keyingsOffered = (state: GameState): string[] =>
  viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined)
    .map(k => `${k.method}:${k.value}`);

/**
 * Item fixture: hero P1 (Aragorn at Rivendell) versus minion P2 (Gorbag at Dol
 * Guldur). Saruman the Wise is a hazard, so his permanent-event form sits in
 * the minion player's `cardsInPlay`.
 */
const itemState = (): GameState => buildTestState({
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
      hand: [], siteDeck: [MINAS_TIRITH],
    },
    {
      id: PLAYER_2,
      alignment: Alignment.Ringwraith,
      companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
      hand: [], siteDeck: [MINAS_MORGUL_MINION],
    },
  ],
});

/**
 * Organization-phase fixture: Wizard P1 at Rivendell (the extra haven a Wizard
 * avatar may be revealed at, rule 2.II.2.1.W1) with Saruman in hand, minion P2
 * holding the given in-play cards.
 */
const sarumanPlayState = (hazardInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [
          { site: RIVENDELL, characters: [ARAGORN] },
          { site: ISENGARD, characters: [LEGOLAS] },
        ],
        hand: [SARUMAN],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [MINAS_MORGUL_MINION],
        cardsInPlay: hazardInPlay,
      },
    ],
  });

/** End-of-turn reset-hand state with Saruman the Wise in P2's cardsInPlay. */
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
  return addCardInPlay(resetHandState, HAZARD_PLAYER, SARUMAN_THE_WISE);
};

describe('Saruman the Wise (as-19)', () => {
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

  // ─── #5: alt keying — the four named regions, and sites in them ───────────

  test('keyable to Enedhwaith by region name (alternative keying)', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, enedhwaithPath()));
    expect(offered).toContain('region-name:Enedhwaith');
    // Neither base arm applies: the path is all Wilderness and the destination
    // is a Ruins & Lairs — the region-name arm is doing the work on its own.
    expect(offered).not.toContain('region-type:free');
    expect(offered).not.toContain('site-type:free-hold');
  });

  test('keyable at Isengard, a site in Gap of Isen ("or at sites in these regions")', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, gapOfIsenSitePath()));
    expect(offered).toContain('region-name:Gap of Isen');
    expect(offered).not.toContain('site-type:free-hold');
  });

  test('not keyable on a Shadow-land path to a Shadow-hold', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, shadowPath()))).toHaveLength(0);
  });

  // ─── #1/#2/#3: three strikes at 13; -3 and detainment vs hero only ────────

  test('attack on a hero company: 3 strikes, prowess 13-3 = 10, detainment', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: full prowess 13, no detainment', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_KEYING);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #6: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH, shadowPath());
    const wiseId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    expect(viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event')).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: wiseId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === wiseId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    // …and a forged tap action is rejected, leaving him in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: wiseId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === wiseId)).toBe(true);
  });

  // ─── #7/#8/#9/#10: ring items give one additional corruption point ────────

  test('a hero ring item costs its bearer one more corruption point', () => {
    const base = itemState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Precious Gold Ring alone: printed corruption 1.
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);

    // Saruman the Wise in play as a permanent-event: 1 → 2.
    const withWise = recomputeDerived(addCardInPlay(withRing, HAZARD_PLAYER, SARUMAN_THE_WISE));
    expect(withWise.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });

  test('only corruption is added — the ring keeps its printed marshalling points', () => {
    const base = itemState();
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);

    const withWise = recomputeDerived(addCardInPlay(withRing, HAZARD_PLAYER, SARUMAN_THE_WISE));
    expect(withWise.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('a non-ring item is unaffected (the filter matches ring items only)', () => {
    const base = itemState();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    // Elven Cloak: printed corruption 1, no `ring` keyword.
    const withCloak = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, ELVEN_CLOAK);
    const withWise = recomputeDerived(addCardInPlay(withCloak, HAZARD_PLAYER, SARUMAN_THE_WISE));

    expect(withWise.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });

  test('"all ring items" — the hazard player\'s own ring is hit too', () => {
    const base = itemState();
    const gorbagId = charIdAt(base, HAZARD_PLAYER);

    // The Least of Gold Rings on the minion bearer: printed corruption 4.
    const withRing = recomputeDerived(attachItemToChar(base, HAZARD_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS));
    expect(withRing.players[HAZARD_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(4);

    // Saruman the Wise is in that same player's cardsInPlay: 4 → 5.
    const withWise = recomputeDerived(addCardInPlay(withRing, HAZARD_PLAYER, SARUMAN_THE_WISE));
    expect(withWise.players[HAZARD_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(5);
  });

  // ─── #11/#12: "Discard this card if Saruman comes into play" ──────────────

  test('Saruman is still revealable while Saruman the Wise is in play', () => {
    // Control: with nothing in play, the Wizard may be revealed at Rivendell.
    const clean = sarumanPlayState([]);
    const cleanSarumanId = findHandCardId(clean, RESOURCE_PLAYER, SARUMAN);
    expect(viablePlayCharacterActions(clean, PLAYER_1)
      .filter(a => a.characterInstanceId === cleanSarumanId).length).toBeGreaterThanOrEqual(1);

    // g.man.1's "unless the current manifestation would leave play" clause: the
    // Wise discards himself when Saruman arrives, so he does not block.
    const withWise = sarumanPlayState([wiseInPlay()]);
    const sarumanId = findHandCardId(withWise, RESOURCE_PLAYER, SARUMAN);
    expect(viablePlayCharacterActions(withWise, PLAYER_1)
      .filter(a => a.characterInstanceId === sarumanId).length).toBeGreaterThanOrEqual(1);
    expect(nonViableOfType(computeLegalActions(withWise, PLAYER_1), 'play-character')
      .some(a => (a.reason ?? '').includes('manifestation'))).toBe(false);
  });

  test('playing Saruman discards the in-play Saruman the Wise', () => {
    const withWise = sarumanPlayState([wiseInPlay()]);
    const sarumanId = findHandCardId(withWise, RESOURCE_PLAYER, SARUMAN);
    const play = viableActions(withWise, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .find(a => a.characterInstanceId === sarumanId);
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(withWise, play!));
    expect(Object.values(after.players[RESOURCE_PLAYER].characters)
      .some(c => c.definitionId === SARUMAN)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMAN_THE_WISE)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, SARUMAN_THE_WISE);
  });

  // ─── #13: manifestation of Saruman — blocked while Saruman is in play ─────

  test('not playable in either mode while the character Saruman is in play', () => {
    const withSaruman = buildTestState({
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
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN] }],
          hand: [SARUMAN_THE_WISE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withSaruman, phaseState: freeRegionPath() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #14: discard when ANY play deck is exhausted ─────────────────────────

  test("discards when the opponent's (minion) play deck exhausts", () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play until the exhaust completes.
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMAN_THE_WISE)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMAN_THE_WISE)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, SARUMAN_THE_WISE);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SARUMAN_THE_WISE)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, SARUMAN_THE_WISE);
  });

  // ─── #15: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, THE_MOUTH, freeRegionPath());
    const withWiseInPlay = addCardInPlay(base, HAZARD_PLAYER, SARUMAN_THE_WISE);

    expect(viableActions(withWiseInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withWiseInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
