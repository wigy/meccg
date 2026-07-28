/**
 * @module as-7.test
 *
 * Card test: Alatar the Hunter (as-7)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Maia.
 * Manifestation of Alatar (tw-117, via `manifestId`).
 * Base creature stats: two strikes, prowess 13, body 9, kill MP 6*.
 * Canonical playable cost (data/cards.json AS-7): {f}{F} — a Free-domain
 * region OR a Free-hold site (different symbols are alternatives).
 *
 * Card text:
 *   "Unique. Maia. Manifestation of Alatar. Two strikes. Attacker chooses
 *    defending characters. Detainment and -3 prowess against hero companies.
 *    Discard this card if Alatar comes into play. As a creature, may also be
 *    played keyed to Andrast, Old Pûkel Gap, Anfalas, Lamedon, Lebennin,
 *    Belfalas, or Anórien; or at sites in these regions. As a permanent-event,
 *    all Maia attacks: receive +1 prowess and +1 strike and attacker chooses
 *    defending characters. Discard when any play deck is exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Two strikes / prowess 13 creature combat                      | IMPLEMENTED |
 * | 2 | Creature mode: attacker chooses defending characters           | IMPLEMENTED |
 * | 3 | Detainment against hero companies (not minion)                 | IMPLEMENTED |
 * | 4 | -3 prowess against hero companies (13 → 10; 13 vs minion)      | IMPLEMENTED |
 * | 5 | Base keying {f} Free-domain / {F} Free-hold                    | IMPLEMENTED |
 * | 6 | Alt keying: the seven named regions; or at sites in them        | IMPLEMENTED |
 * | 7 | Permanent-event mode: enters play, stays (no tap conversion)    | IMPLEMENTED |
 * | 8 | Permanent-event: every Maia attack gets +1 prowess              | IMPLEMENTED |
 * | 9 | Permanent-event: every Maia attack gets +1 strike               | IMPLEMENTED |
 * |10 | Permanent-event: every Maia attack — attacker chooses defenders | IMPLEMENTED |
 * |11 | Non-Maia attacks are untouched by the permanent-event           | IMPLEMENTED |
 * |12 | Discard this card if Alatar comes into play                     | IMPLEMENTED |
 * |13 | Manifestation of Alatar — unplayable while Alatar is in play     | IMPLEMENTED |
 * |14 | Discard when any play deck is exhausted                         | IMPLEMENTED |
 * |15 | Unique — a second copy is unplayable while one is in play        | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2 shape),
 * creature-alt-event (permanent-event, persistent — as-11/as-13 shape),
 * combat-attacker-chooses-defenders (creature mode, Cave-drake shape),
 * combat-detainment (hero / covert fallen-wizard defenders), stat-modifier
 * prowess -3 vs hero, discard-self-when `charactersInPlayAnywhere: "Alatar"`,
 * stat-modifier prowess/strikes +1 with `target: "all-attacks"` gated on
 * `enemy.race: "maia"` (Wake of War tw-108 shape), a **global**
 * combat-attacker-chooses-defenders (`scope: "all-attacks"`, gated on
 * `attack.creatureRace: "maia"`), and on-event play-deck-exhausted
 * self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  makeMHState, addCardInPlay, buildMinionSitePhaseState, setupAutoAttackStep,
  playCreatureHazardAndResolve,
  handCardId, findHandCardId, companyIdAt,
  viableActions, nonViableOfType, dispatch, resolveChain, reduce,
  expectInDiscardPile,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, GameState, EndOfTurnPhaseState, PlayCharacterAction,
} from '../../index.js';

const THE_HUNTER = 'as-7' as CardDefinitionId;

/** The Wizard Alatar and his homesite — the manifestation this card shadows. */
const ALATAR = 'tw-117' as CardDefinitionId;
const EDHELLOND = 'tw-393' as CardDefinitionId;

/** Minion characters and sites (the hazard is played against either side). */
const THE_MOUTH = 'le-24' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;

/** Rhosgobel (as-159): two Maia automatic-attacks, 1 strike with 13 prowess. */
const RHOSGOBEL = 'as-159' as CardDefinitionId;
/** Dimrill Dale (le-365): a single Orc automatic-attack, 1 strike with 6 prowess. */
const DIMRILL_DALE = 'le-365' as CardDefinitionId;

/** Filler card so an "exhausted" play deck still has a discard pile. */
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;

const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

/** {f} arm only: Lindon is a Free-domain region outside the seven named ones. */
const freeRegionPath = () => makeMHState({
  resolvedSitePath: [RegionType.Free],
  resolvedSitePathNames: ['Lindon'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Barad-dûr (ruins)',
});

/** {F} arm only: a Free-hold reached through an unnamed Wilderness. */
const freeHoldPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['High Pass'],
  destinationSiteType: SiteType.FreeHold,
  destinationSiteName: "Eagles' Eyrie",
});

/** Alt arm only: Old Pûkel Gap is a named *Wilderness* region crossed en route. */
const pukelGapPath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Old Pûkel Gap'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Isengard',
});

/** Alt arm only, "or at sites in these regions": the destination's own region. */
const anfalasSitePath = () => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Anfalas'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Cameth Brin',
});

/** No arm matches: shadow-land path to a shadow-hold, no named region. */
const shadowPath = () => makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Minas Morgul',
});

const hunterInPlay = (): CardInPlay => ({
  instanceId: mint(),
  definitionId: THE_HUNTER,
  status: CardStatus.Untapped,
});

/**
 * M/H fixture: the Hunter in P2's hand as the hazard player, P1's single
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
        companies: [{ site, characters: [characterId, alignment === Alignment.Ringwraith ? GORBAG : LEGOLAS] }],
        hand: [],
        siteDeck: [alignment === Alignment.Ringwraith ? BARAD_DUR : MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [GIMLI] }],
        hand: [THE_HUNTER],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/** The keying methods/values offered for the Hunter in a given fixture. */
const keyingsOffered = (state: GameState): string[] =>
  viableActions(state, PLAYER_2, 'play-hazard')
    .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy)
    .filter((k): k is { method: string; value: string } => k !== undefined)
    .map(k => `${k.method}:${k.value}`);

/**
 * Site-phase fixture at a minion site whose automatic-attack is about to fire,
 * with `hunterInPlay` copies in the hazard player's `cardsInPlay`. Returns the
 * state after the active player passes into the attack.
 */
const siteAutoAttack = (site: CardDefinitionId, withHunter: boolean): GameState => {
  const ready = setupAutoAttackStep(buildMinionSitePhaseState({
    site,
    characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
  }));
  const staged = withHunter ? addCardInPlay(ready, HAZARD_PLAYER, THE_HUNTER) : ready;
  return dispatch(staged, { type: 'pass', player: PLAYER_1 });
};

/**
 * Organization-phase fixture: hero P1 at Edhellond (Alatar's homesite) with
 * Alatar in hand, minion P2 holding the given in-play cards.
 */
const alatarPlayState = (hazardInPlay: CardInPlay[]): GameState =>
  buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: EDHELLOND, characters: [ARAGORN] }],
        hand: [ALATAR],
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

/** End-of-turn reset-hand state with the Hunter in P2's cardsInPlay. */
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
  return addCardInPlay(resetHandState, HAZARD_PLAYER, THE_HUNTER);
};

describe('Alatar the Hunter (as-7)', () => {
  beforeEach(() => resetMint());

  // ─── #5: base keying {f}{F} — the two arms are alternatives ───────────────

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

  // ─── #6: alt keying — the seven named regions, and sites in them ──────────

  test('keyable to Old Pûkel Gap by region name (alternative keying)', () => {
    const offered = keyingsOffered(readyState(Alignment.Wizard, ARAGORN, pukelGapPath()));
    expect(offered).toContain('region-name:Old Pûkel Gap');
    // Neither base arm applies: Old Pûkel Gap is a Wilderness and the
    // destination is a Ruins & Lairs — the region-name arm stands alone.
    expect(offered).not.toContain('region-type:free');
    expect(offered).not.toContain('site-type:free-hold');
  });

  test('keyable at a site in Anfalas ("or at sites in these regions")', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, anfalasSitePath())))
      .toContain('region-name:Anfalas');
  });

  test('not keyable on a Shadow-land path to a Shadow-hold', () => {
    expect(keyingsOffered(readyState(Alignment.Wizard, ARAGORN, shadowPath()))).toHaveLength(0);
  });

  // ─── #1/#3/#4: two strikes at 13; -3 and detainment vs hero only ──────────

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

  // ─── #2: creature mode — "Attacker chooses defending characters" ──────────

  test('as a creature the hazard player assigns the strikes, not the defender', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_KEYING);
    expect(after.combat!.attackerChoosesDefenders).toBe(true);
    expect(after.combat!.assignmentPhase).toBe('cancel-window');

    // The defender closes the cancel window; assignment passes to the attacker.
    const afterPass = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThanOrEqual(1);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  // ─── #7: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, THE_MOUTH, shadowPath());
    const hunterId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    expect(viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event')).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: hunterId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === hunterId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent: no tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);
    // …and a forged tap action is rejected, leaving him in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: hunterId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === hunterId)).toBe(true);
  });

  // ─── #8/#9/#10: "all Maia attacks: +1 prowess, +1 strike, attacker chooses"

  test('a Maia automatic-attack is 1×13 with the defender assigning, on its own', () => {
    const attack = siteAutoAttack(RHOSGOBEL, false);
    expect(attack.combat).not.toBeNull();
    expect(attack.combat!.creatureRace).toBe('maia');
    expect(attack.combat!.strikesTotal).toBe(1);
    expect(attack.combat!.strikeProwess).toBe(13);
    expect(attack.combat!.attackerChoosesDefenders).toBeUndefined();
    expect(attack.combat!.assignmentPhase).toBe('defender');
  });

  test('with the Hunter in play that Maia attack becomes 2 strikes at 14 prowess', () => {
    const attack = siteAutoAttack(RHOSGOBEL, true);
    expect(attack.combat).not.toBeNull();
    expect(attack.combat!.creatureRace).toBe('maia');
    expect(attack.combat!.strikesTotal).toBe(2);
    expect(attack.combat!.strikeProwess).toBe(14);
  });

  test('with the Hunter in play the attacker chooses defenders for the Maia attack', () => {
    const attack = siteAutoAttack(RHOSGOBEL, true);
    expect(attack.combat!.attackerChoosesDefenders).toBe(true);
    expect(attack.combat!.assignmentPhase).toBe('cancel-window');

    const afterPass = dispatch(attack, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThanOrEqual(1);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });

  // ─── #11: only Maia attacks are affected ──────────────────────────────────

  test('an Orc automatic-attack is untouched by the Hunter in play', () => {
    const alone = siteAutoAttack(DIMRILL_DALE, false);
    expect(alone.combat!.creatureRace).toBe('orc');
    expect(alone.combat!.strikesTotal).toBe(1);
    expect(alone.combat!.strikeProwess).toBe(6);

    const withHunter = siteAutoAttack(DIMRILL_DALE, true);
    expect(withHunter.combat!.strikesTotal).toBe(1);
    expect(withHunter.combat!.strikeProwess).toBe(6);
    expect(withHunter.combat!.attackerChoosesDefenders).toBeUndefined();
    expect(withHunter.combat!.assignmentPhase).toBe('defender');
  });

  // ─── #12: "Discard this card if Alatar comes into play" ───────────────────

  test('Alatar is still playable while the Hunter is in play as a permanent-event', () => {
    // Control: with nothing in play, the hero player may bring Alatar in at
    // his homesite Edhellond.
    expect(viableActions(alatarPlayState([]), PLAYER_1, 'play-character').length)
      .toBeGreaterThanOrEqual(1);

    // g.man.1's "unless the current manifestation would leave play" clause: the
    // Hunter discards itself when Alatar arrives, so it does not block.
    const withHunter = alatarPlayState([hunterInPlay()]);
    expect(viableActions(withHunter, PLAYER_1, 'play-character').length).toBeGreaterThanOrEqual(1);
    expect(nonViableOfType(computeLegalActions(withHunter, PLAYER_1), 'play-character')
      .some(a => (a.reason ?? '').includes('manifestation'))).toBe(false);
  });

  test('playing Alatar discards the in-play Hunter', () => {
    const withHunter = alatarPlayState([hunterInPlay()]);
    const alatarId = findHandCardId(withHunter, RESOURCE_PLAYER, ALATAR);
    const play = viableActions(withHunter, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .find(a => a.characterInstanceId === alatarId);
    expect(play).toBeDefined();

    const after = resolveChain(dispatch(withHunter, play!));
    expect(Object.values(after.players[RESOURCE_PLAYER].characters)
      .some(c => c.definitionId === ALATAR)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_HUNTER)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, THE_HUNTER);
  });

  // ─── #13: manifestation of Alatar — blocked while Alatar is in play ───────

  test('not playable in either mode while the character Alatar is in play', () => {
    const withAlatar = buildTestState({
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
          companies: [{ site: LORIEN, characters: [ALATAR] }],
          hand: [THE_HUNTER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withAlatar, phaseState: freeRegionPath() };

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
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_HUNTER)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_HUNTER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, THE_HUNTER);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_HUNTER)).toBe(false);
    expectInDiscardPile(afterPass, HAZARD_PLAYER, THE_HUNTER);
  });

  // ─── #15: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, THE_MOUTH, freeRegionPath());
    const withHunterInPlay = addCardInPlay(base, HAZARD_PLAYER, THE_HUNTER);

    expect(viableActions(withHunterInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withHunterInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
