/**
 * @module td-88.test
 *
 * Card test: Worm's Stench (td-88)
 * Type: hazard-event (short, company-targeting)
 *
 * Card text:
 *   "Playable on a company that has already faced a Dragon or Drake attack
 *    this turn. The prowess of each Spider and Animal attack against the
 *    company is increased by two for the rest of the turn. Additionally, if
 *    Doors of Night is in play, all Wolf attacks receive +2 prowess and all
 *    Wolf, Spider, and Animal attacks receive +1 strikes for the rest of turn
 *    against the company."
 *
 * Effects:
 *   - `play-target: company`
 *   - `play-condition: target-company` — `company.facedRaces` includes
 *     `dragon` or `drake` (the turn-scoped `Company.facedHazardRaces`,
 *     stamped at every attack teardown and cleared at the next untap phase).
 *   - three `on-event self-enters-play → add-constraint creature-attack-boost`
 *     (scope `turn`, company target): Spider/Animal +2 prowess; with Doors of
 *     Night in play, Wolf +2 prowess and Wolf/Spider/Animal +1 strikes.
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                          |
 * |---|--------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Playable only after a Dragon/Drake attack        | IMPLEMENTED | target-company play-condition on short-events  |
 * | 2 | Spider/Animal +2 prowess vs company, rest of turn | IMPLEMENTED | creature-attack-boost (company, turn scope)    |
 * | 3 | DoN: Wolf +2 prowess                             | IMPLEMENTED | `when: inPlay Doors of Night`                  |
 * | 4 | DoN: Wolf/Spider/Animal +1 strikes               | IMPLEMENTED | `when: inPlay Doors of Night`                  |
 *
 * Certified: 2026-10-30
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DOORS_OF_NIGHT,
  buildTestState, resetMint, addCardInPlay,
  makeMHState,
  findHandCardId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, Race } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WORMS_STENCH = 'td-88' as CardDefinitionId;
/** Wolves — 3 strikes at prowess 8. */
const WOLVES = 'tw-114' as CardDefinitionId;
/** Giant Spiders — 2 strikes at prowess 10. */
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId;
/**
 * Crebain — Animals at prowess 5. Each character faces one strike, so only
 * its prowess is asserted (the strike count tracks the company size).
 */
const CREBAIN = 'tw-25' as CardDefinitionId;
/** Orc-patrol — 3 strikes at prowess 6; the non-boosted control race. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;

/**
 * M/H state with Worm's Stench plus the beasts in the hazard hand, the moving
 * company on a path (two Wildernesses + a Border-land to a Ruins & Lairs) that
 * keys every test creature, and the given races already faced this turn.
 */
const setup = (opts: { faced: Race[]; doorsOfNight?: boolean }): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [WORMS_STENCH, WOLVES, GIANT_SPIDERS, CREBAIN, ORC_PATROL], siteDeck: [RIVENDELL] },
    ],
  });
  const withDon = opts.doorsOfNight ? addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT) : base;
  const p0 = withDon.players[RESOURCE_PLAYER];
  const faced = {
    ...p0,
    companies: p0.companies.map((c, i) => (i === 0 ? { ...c, facedHazardRaces: opts.faced } : c)),
  };
  return {
    ...withDon,
    players: [faced, withDon.players[HAZARD_PLAYER]] as unknown as GameState['players'],
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Border],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
      hazardLimitAtReveal: 6,
    }),
  };
};

/** The viable play action for Worm's Stench, if any. */
const stenchPlay = (state: GameState) => {
  const id = findHandCardId(state, HAZARD_PLAYER, WORMS_STENCH);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === id);
};

/** Play Worm's Stench on the moving company and resolve its chain. */
const playStench = (state: GameState) => {
  const play = stenchPlay(state);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
};

/** Play a keyed creature from the hazard hand and return the resulting combat. */
const attackWith = (state: GameState, creature: CardDefinitionId) => {
  const creatureId = findHandCardId(state, HAZARD_PLAYER, creature);
  const play = viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === creatureId && !!a.action.keyedBy);
  expect(play).toBeDefined();
  const after = resolveChain(dispatch(state, play!.action));
  expect(after.combat).not.toBeNull();
  return after.combat!;
};

describe("Worm's Stench (td-88)", () => {
  beforeEach(() => resetMint());

  // ─── Play condition ────────────────────────────────────────────────────────

  test('playable on a company that has already faced a Dragon attack this turn', () => {
    const play = stenchPlay(setup({ faced: [Race.Dragon] }));
    expect(play).toBeDefined();
    expect(play!.action.type === 'play-hazard' && play!.action.targetCompanyId)
      .toBe(companyIdAt(setup({ faced: [Race.Dragon] }), RESOURCE_PLAYER));
  });

  test('playable on a company that has already faced a Drake attack this turn', () => {
    expect(stenchPlay(setup({ faced: [Race.Orc, Race.Drake] }))).toBeDefined();
  });

  test('NOT playable on a company that has faced no attack this turn', () => {
    expect(stenchPlay(setup({ faced: [] }))).toBeUndefined();
  });

  test('NOT playable on a company that has only faced non-Dragon/Drake attacks', () => {
    expect(stenchPlay(setup({ faced: [Race.Orc, Race.Wolf] }))).toBeUndefined();
  });

  // ─── Base effect (no Doors of Night) ───────────────────────────────────────

  test('Spider and Animal attacks against the company get +2 prowess, strikes unchanged', () => {
    const after = playStench(setup({ faced: [Race.Dragon] }));
    const spiders = attackWith(after, GIANT_SPIDERS);
    expect(spiders.strikeProwess).toBe(12);
    expect(spiders.strikesTotal).toBe(2);
    expect(attackWith(after, CREBAIN).strikeProwess).toBe(7);
  });

  test('without Doors of Night, Wolf attacks are not modified', () => {
    const after = playStench(setup({ faced: [Race.Dragon] }));
    const wolves = attackWith(after, WOLVES);
    expect(wolves.strikeProwess).toBe(8);
    expect(wolves.strikesTotal).toBe(3);
  });

  test('other races (Orcs) are never modified', () => {
    const after = playStench(setup({ faced: [Race.Dragon], doorsOfNight: true }));
    const orcs = attackWith(after, ORC_PATROL);
    expect(orcs.strikeProwess).toBe(6);
    expect(orcs.strikesTotal).toBe(3);
  });

  test('the boost lasts for the rest of the turn (turn-scoped, company-targeted constraint)', () => {
    const before = setup({ faced: [Race.Drake] });
    const compId = companyIdAt(before, RESOURCE_PLAYER);
    const after = playStench(before);
    const boosts = after.activeConstraints.filter(c => c.kind.type === 'creature-attack-boost');
    expect(boosts).toHaveLength(1);
    expect(boosts[0].scope).toEqual({ kind: 'turn' });
    expect(boosts[0].target).toEqual({ kind: 'company', companyId: compId });
  });

  test('without Worm\'s Stench the beasts attack at printed values', () => {
    const state = setup({ faced: [Race.Dragon], doorsOfNight: true });
    const spiders = attackWith(state, GIANT_SPIDERS);
    expect(spiders.strikeProwess).toBe(10);
    expect(spiders.strikesTotal).toBe(2);
  });

  // ─── Doors of Night ────────────────────────────────────────────────────────

  test('with Doors of Night, Wolf attacks get +2 prowess and +1 strikes', () => {
    const after = playStench(setup({ faced: [Race.Dragon], doorsOfNight: true }));
    const wolves = attackWith(after, WOLVES);
    expect(wolves.strikeProwess).toBe(10);
    expect(wolves.strikesTotal).toBe(4);
  });

  test('with Doors of Night, Spider attacks get +2 prowess and +1 strikes, Animals still +2 prowess', () => {
    const after = playStench(setup({ faced: [Race.Drake], doorsOfNight: true }));
    const spiders = attackWith(after, GIANT_SPIDERS);
    expect(spiders.strikeProwess).toBe(12);
    expect(spiders.strikesTotal).toBe(3);
    expect(attackWith(after, CREBAIN).strikeProwess).toBe(7);
  });

  test('with Doors of Night, the strikes boost also covers Animal attacks against the company', () => {
    const before = setup({ faced: [Race.Dragon], doorsOfNight: true });
    const compId = companyIdAt(before, RESOURCE_PLAYER);
    const after = playStench(before);
    const strikeBoosts = after.activeConstraints.filter(c =>
      c.kind.type === 'creature-attack-boost' && c.kind.strikes === 1
      && c.target.kind === 'company' && c.target.companyId === compId);
    expect(strikeBoosts).toHaveLength(1);
    const kind = strikeBoosts[0].kind as { race: readonly Race[] };
    expect([...kind.race].sort()).toEqual([Race.Animal, Race.Spider, Race.Wolf].sort());
  });

  test('the card is discarded once its chain resolves', () => {
    const after = playStench(setup({ faced: [Race.Dragon] }));
    const hazardPlayer = after.players[HAZARD_PLAYER];
    expect(hazardPlayer.hand.some(c => c.definitionId === WORMS_STENCH)).toBe(false);
    expect(hazardPlayer.discardPile.some(c => c.definitionId === WORMS_STENCH)).toBe(true);
  });
});
