/**
 * @module as-17.test
 *
 * Card test: Pallando the Soul-keeper (as-17)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Maia.
 * Manifestation of Pallando (tw-175, via `manifestId`).
 * Base creature stats: two strikes, prowess 13, body 9, kill MP 6*.
 * Canonical playable cost (data/cards.json AS-17): {f}{F} — a Free-domain
 * region OR a Free-hold site (different symbols are alternatives).
 *
 * Card text:
 *   "Unique. Maia. Manifestation of Pallando. Two strikes. Detainment and -3
 *    prowess against hero companies. Discard this card if Pallando comes into
 *    play. As a creature, may also be played keyed to Lindon, Númeriador,
 *    Arthedain, or Cardolan; or at sites in these regions. As a
 *    permanent-event, the next non-Ringwraith minion discarded from play is
 *    instead eliminated. Discard when a minion is so eliminated."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Two strikes / prowess 13 creature combat                      | IMPLEMENTED |
 * | 2 | Detainment against hero companies (not minion)                | IMPLEMENTED |
 * | 3 | -3 prowess against hero companies (13 → 10; 13 vs minion)     | IMPLEMENTED |
 * | 4 | Base keying {f} Free-domain / {F} Free-hold                   | IMPLEMENTED |
 * | 5 | Alt keying: the four named regions; or at sites in them        | IMPLEMENTED |
 * | 6 | Permanent-event mode: enters play, stays (no tap conversion)   | IMPLEMENTED |
 * | 7 | The next non-Ringwraith minion discarded is instead eliminated | IMPLEMENTED |
 * | 8 | A Ringwraith minion is exempt — still discarded                | IMPLEMENTED |
 * | 9 | A hero character is exempt — still discarded                   | IMPLEMENTED |
 * |10 | Discard when a minion is so eliminated (one-shot)              | IMPLEMENTED |
 * |11 | Discard this card if Pallando comes into play                  | IMPLEMENTED |
 * |12 | Manifestation of Pallando — unplayable while Pallando is in play| IMPLEMENTED |
 * |13 | Unique — a second copy is unplayable while one is in play      | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2 shape),
 * creature-alt-event (permanent-event, persistent — as-13 shape),
 * combat-detainment (hero / covert fallen-wizard defenders), stat-modifier
 * prowess -3 vs hero (as-11 shape), discard-self-when
 * `charactersInPlayAnywhere: "Pallando"`, and eliminate-instead-of-discard with
 * filter `{ cardType: minion-character, race: { $ne: ringwraith } }` +
 * `discardSelf` (the "next … is instead eliminated / discard when so
 * eliminated" replacement).
 *
 * Rule 7 is exercised on three of the five discard-from-play seams the
 * replacement is wired into: the combat body-check discard band (a minion's
 * printed `discardBodyCheck` number), the rule-3.22 voluntary organization
 * discard, and `discardCharacterToDiscardPile` (the shared helper behind the
 * dice-check discards). Rules 8 and 9 use the same helper so the filter is read
 * on a live removal rather than off the card JSON.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  makeMHState, makeShadowMHState, makeBodyCheckCombat, addCardInPlay,
  playCreatureHazardAndResolve, setCharStatus,
  handCardId, findHandCardId, findCharInstanceId, companyIdAt,
  viableActions, nonViableOfType, dispatch, resolveChain, reduce,
  expectInDiscardPile,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus, GREY_HAVENS,
} from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  DiscardCharacterOrgAction, PlayCharacterAction,
} from '../../index.js';
import { discardCharacterToDiscardPile } from '../../engine/pending-reducers.js';

const SOUL_KEEPER = 'as-17' as CardDefinitionId;
/** The Wizard character this card is a manifestation of. */
const PALLANDO = 'tw-175' as CardDefinitionId;

/** Minion characters. */
const THE_MOUTH = 'le-24' as CardDefinitionId;      // man, non-Ringwraith minion
const ASTERNAK = 'le-1' as CardDefinitionId;        // man, non-Ringwraith minion
const TROLL_CHIEF = 'le-45' as CardDefinitionId;    // troll, body 9, discardBodyCheck [9]
const KHAMUL = 'le-55' as CardDefinitionId;         // Ringwraith avatar (race ringwraith)

/** Minion sites. */
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven (rule-3.22 discards allowed)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold
const CARN_DUM = 'le-359' as CardDefinitionId;      // dark-hold (body-check fixture site)

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

/** Alt arm only: Cardolan (a Wilderness) crossed on the way. */
const cardolanPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Cardolan'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Barrow-downs',
});

/** Alt arm only, "or at sites in these regions": the destination's own region. */
const numeriadorSitePath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Númeriador'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Bandit Lair',
});

/** No arm matches: shadow-land path to a shadow-hold, no named region. */
const shadowPath = () => makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Minas Morgul',
});

const soulKeeperInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: SOUL_KEEPER,
  status: CardStatus.Untapped,
});

/**
 * M/H fixture: the Soul-keeper in P2's hand as the hazard player, P1's single
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
        hand: [SOUL_KEEPER],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/** The keying methods/values offered for the Soul-keeper in a given fixture. */
const keyingsOffered = (state: GameState): string[] =>
  viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined)
    .map(k => `${k.method}:${k.value}`);

/**
 * Organization fixture: a minion P1 at Dol Guldur (a Darkhaven, so rule-3.22
 * voluntary discards are legal) with the given characters; the hero opponent P2
 * holds any `hazardInPlay` cards — the Soul-keeper is a hazard, so its
 * controller is the non-active player here.
 */
const minionOrgState = (
  characters: CardDefinitionId[],
  hazardInPlay: CardInPlay[] = [],
): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters }],
        hand: [],
        siteDeck: [BARAD_DUR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: hazardInPlay,
      },
    ],
  });

/** The rule-3.22 voluntary-discard action for a named character. */
const orgDiscardAction = (state: GameState, charId: CardInstanceId) =>
  viableActions(state, PLAYER_1, 'discard-character')
    .find(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId === charId)!.action;

/**
 * Body-check fixture: minion P1's Troll-chief (printed "discard on a body check
 * result of 9") is wounded and about to body-check; hero P2 holds the given
 * in-play cards.
 */
const trollChiefBodyCheck = (hazardInPlay: CardInPlay[]): GameState => {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [TROLL_CHIEF] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: hazardInPlay,
      },
    ],
  });
  const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const wounded = setCharStatus(state, RESOURCE_PLAYER, TROLL_CHIEF, CardStatus.Inverted);
  return {
    ...wounded,
    phaseState: makeShadowMHState(),
    combat: makeBodyCheckCombat({ companyId, characterId: chiefId, defendingPlayerId: PLAYER_1, attackingPlayerId: PLAYER_2 }),
    cheatRollTotal: 9,
  };
};

/**
 * Organization fixture for the Pallando-comes-into-play clause: hero P1 at the
 * Grey Havens (Pallando's homesite) with Pallando in hand, minion P2 holding
 * the given in-play cards.
 */
const pallandoPlayState = (hazardInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: GREY_HAVENS, characters: [ARAGORN] }],
        hand: [PALLANDO],
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

describe('Pallando the Soul-keeper (as-17)', () => {
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

  test('keyable to Cardolan by region name (alternative keying)', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, cardolanPath()));
    expect(offered).toContain('region-name:Cardolan');
    // Neither base arm applies: Cardolan is a Wilderness and the destination is
    // a Ruins & Lairs — so the region-name arm is doing the work on its own.
    expect(offered).not.toContain('region-type:free');
    expect(offered).not.toContain('site-type:free-hold');
  });

  test('keyable at a site in Númeriador ("or at sites in these regions")', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, numeriadorSitePath())))
      .toContain('region-name:Númeriador');
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
    const keeperId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    expect(viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event')).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: keeperId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === keeperId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    // …and a forged tap action is rejected, leaving him in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: keeperId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === keeperId)).toBe(true);
  });

  // ─── #7: the next non-Ringwraith minion discarded is instead eliminated ───

  test('a minion discarded by its printed body-check number is eliminated instead', () => {
    // Control: with nothing in play, Troll-chief's "discard on a body check
    // result of 9" sends it to the discard pile.
    const control = trollChiefBodyCheck([]);
    const chiefId = findCharInstanceId(control, RESOURCE_PLAYER, TROLL_CHIEF);
    const afterControl = dispatch(control, viableActions(control, PLAYER_2, 'body-check-roll')[0].action);
    expect(afterControl.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === chiefId)).toBe(true);
    expect(afterControl.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === chiefId)).toBe(false);

    // With the Soul-keeper in play, the same discard becomes an elimination.
    const ready = trollChiefBodyCheck([soulKeeperInPlay()]);
    const after = dispatch(ready, viableActions(ready, PLAYER_2, 'body-check-roll')[0].action);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === chiefId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === chiefId)).toBe(false);
  });

  test('a minion voluntarily discarded at a haven (rule 3.22) is eliminated instead', () => {
    // Control: no Soul-keeper — The Mouth reaches its owner's discard pile.
    const control = minionOrgState([THE_MOUTH, ASTERNAK]);
    const mouthId = findCharInstanceId(control, RESOURCE_PLAYER, THE_MOUTH);
    const afterControl = dispatch(control, orgDiscardAction(control, mouthId));
    expect(afterControl.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === mouthId)).toBe(true);
    expect(afterControl.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mouthId)).toBe(false);

    const ready = minionOrgState([THE_MOUTH, ASTERNAK], [soulKeeperInPlay()]);
    const readyMouthId = findCharInstanceId(ready, RESOURCE_PLAYER, THE_MOUTH);
    const after = dispatch(ready, orgDiscardAction(ready, readyMouthId));
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === readyMouthId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === readyMouthId)).toBe(false);
    // The character left its company either way.
    expect(after.players[RESOURCE_PLAYER].characters[readyMouthId]).toBeUndefined();
  });

  test('a minion sent to the discard pile by a card effect is eliminated instead', () => {
    const ready = minionOrgState([THE_MOUTH, ASTERNAK], [soulKeeperInPlay()]);
    const mouthId = findCharInstanceId(ready, RESOURCE_PLAYER, THE_MOUTH);
    const after = discardCharacterToDiscardPile(
      ready, RESOURCE_PLAYER, mouthId, ready.players[RESOURCE_PLAYER].characters[mouthId],
    );
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mouthId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === mouthId)).toBe(false);
  });

  // ─── #8: a Ringwraith minion is exempt ────────────────────────────────────

  test('a Ringwraith is NOT eliminated — it still reaches the discard pile', () => {
    const ready = minionOrgState([KHAMUL, THE_MOUTH], [soulKeeperInPlay()]);
    const khamulId = findCharInstanceId(ready, RESOURCE_PLAYER, KHAMUL);
    const after = discardCharacterToDiscardPile(
      ready, RESOURCE_PLAYER, khamulId, ready.players[RESOURCE_PLAYER].characters[khamulId],
    );
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === khamulId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === khamulId)).toBe(false);
    // …and the Soul-keeper is not consumed by a discard it did not replace.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SOUL_KEEPER)).toBe(true);
  });

  // ─── #9: a hero character is exempt ("minion") ────────────────────────────

  test('a hero character is NOT eliminated — the rule names minions only', () => {
    const base = minionOrgState([THE_MOUTH], [soulKeeperInPlay()]);
    const aragornId = findCharInstanceId(base, HAZARD_PLAYER, ARAGORN);
    const after = discardCharacterToDiscardPile(
      base, HAZARD_PLAYER, aragornId, base.players[HAZARD_PLAYER].characters[aragornId],
    );
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SOUL_KEEPER)).toBe(true);
  });

  // ─── #10: "Discard when a minion is so eliminated" — one-shot ─────────────

  test('the Soul-keeper is discarded once it eliminates a minion, and only the first is affected', () => {
    const ready = minionOrgState([THE_MOUTH, ASTERNAK], [soulKeeperInPlay()]);
    const mouthId = findCharInstanceId(ready, RESOURCE_PLAYER, THE_MOUTH);

    const afterFirst = dispatch(ready, orgDiscardAction(ready, mouthId));
    expect(afterFirst.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mouthId)).toBe(true);
    // The card left play and went to its controller's discard pile.
    expect(afterFirst.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SOUL_KEEPER)).toBe(false);
    expectInDiscardPile(afterFirst, HAZARD_PLAYER, SOUL_KEEPER);

    // "The next" — only one minion is converted; the second is plainly discarded.
    const asternakId = findCharInstanceId(afterFirst, RESOURCE_PLAYER, ASTERNAK);
    const afterSecond = dispatch(afterFirst, orgDiscardAction(afterFirst, asternakId));
    expect(afterSecond.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === asternakId)).toBe(true);
    expect(afterSecond.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === asternakId)).toBe(false);
  });

  // ─── #11: "Discard this card if Pallando comes into play" ─────────────────

  test('Pallando is still playable while the Soul-keeper is in play as a permanent-event', () => {
    // Control: with nothing in play, the hero player may bring Pallando in at
    // his homesite, the Grey Havens.
    expect(viableActions(pallandoPlayState([]), PLAYER_1, 'play-character').length)
      .toBeGreaterThanOrEqual(1);

    // g.man.1's "unless the current manifestation would leave play" clause: the
    // Soul-keeper discards itself when Pallando arrives, so it does not block.
    const withKeeper = pallandoPlayState([soulKeeperInPlay()]);
    const plays = viableActions(withKeeper, PLAYER_1, 'play-character');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    expect(nonViableOfType(computeLegalActions(withKeeper, PLAYER_1), 'play-character')
      .some(a => (a.reason ?? '').includes('manifestation'))).toBe(false);
  });

  test('playing Pallando discards the in-play Soul-keeper', () => {
    const withKeeper = pallandoPlayState([soulKeeperInPlay()]);
    const pallandoId = findHandCardId(withKeeper, RESOURCE_PLAYER, PALLANDO);
    const play = viableActions(withKeeper, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .find(a => a.characterInstanceId === pallandoId);
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(withKeeper, play!));
    expect(Object.values(after.players[RESOURCE_PLAYER].characters)
      .some(c => c.definitionId === PALLANDO)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SOUL_KEEPER)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, SOUL_KEEPER);
  });

  // ─── #12: manifestation of Pallando — blocked while Pallando is in play ───

  test('not playable in either mode while the character Pallando is in play', () => {
    const withPallando = buildTestState({
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
          companies: [{ site: GREY_HAVENS, characters: [PALLANDO] }],
          hand: [SOUL_KEEPER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withPallando, phaseState: freeRegionPath() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #13: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, THE_MOUTH, freeRegionPath());
    const withKeeperInPlay = addCardInPlay(base, HAZARD_PLAYER, SOUL_KEEPER);

    expect(viableActions(withKeeperInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withKeeperInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
