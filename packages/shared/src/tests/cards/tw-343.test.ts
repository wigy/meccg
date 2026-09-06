/**
 * @module tw-343.test
 *
 * Card test: The Evenstar (tw-343)
 * Type: hero-resource-event (short, Environment), non-unique.
 *
 * Card text:
 *   "Environment. The prowess of one Elf is modified by +1 until the end of
 *    the turn. Additionally, if Gates of Morning is in play: the prowess of
 *    each Elf is modified by +1 (until the end of the turn); and, you may
 *    choose: one Wilderness [{w}] to treat as a Border-land [{b}] or one
 *    Border-land [{b}] to treat as a Free-domain [{f}]. Cannot be duplicated."
 *
 * CRF 22 rulings: "Can be played even if there are no Wildernesses [or
 * Border-lands] in play" — the region choice is a "may", never a play
 * requirement — and "Does not affect hazards" (a stock clarification also
 * printed, in French, on Star of High Hope td-154, which carries no region
 * clause at all — it is not specific to this card's terrain choice).
 *
 * Rule coverage:
 *
 * | # | Rule                                                            | Status | Notes                                             |
 * |---|------------------------------------------------------------------|--------|----------------------------------------------------|
 * | 1 | +1 prowess on one chosen Elf, until end of turn                  | FIXED  | `play-target` + `character-stat-modifier` (turn)   |
 * | 2 | Playable with only one Elf and no Gates of Morning               | FIXED  | base effects have no `when` gate                   |
 * | 3 | Playable even absent any Wilderness/Border-land (CRF ruling)     | FIXED  | region-transform is optional, never blocks the card|
 * | 4 | With Gates of Morning: chosen Elf's total reaches +2             | FIXED  | targeted +1 stacks with the broadcast +1           |
 * | 5 | With Gates of Morning: every *other* Elf also gets +1            | FIXED  | new `character-stat-modifier` broadcast mode       |
 * | 6 | Without Gates of Morning: other Elves are unaffected             | FIXED  | broadcast on-event gated on `inPlay: Gates of Morning` |
 * | 7 | Non-Elves are never affected                                     | FIXED  | `play-target` filter + broadcast `filter`          |
 * | 8 | Region choice only offered when Gates of Morning is in play      | FIXED  | `region-transform.when`                            |
 * | 9 | One Wilderness → Border-land (creature keying reflects it)       | FIXED  | `region-transform`, new `duration: "turn"`         |
 * | 10| One Border-land → Free-domain (creature keying reflects it)      | FIXED  | same effect                                        |
 * | 11| The region override lasts only until end of turn (not permanent) | FIXED  | `duration: "turn"` → `scope: { kind: 'turn' }`     |
 * | 12| Cannot be duplicated (per turn)                                  | FIXED  | `duplication-limit` scope turn, max 1              |
 * | 13| Not playable with no Elf in any company                          | FIXED  | `play-target` yields no candidates                 |
 *
 * The card combines an ordinary cost-less character `play-target` (the
 * chosen Elf) with an *optional* `region-transform` layered on top — new
 * engine support added for this certification:
 *   - `region-transform` gained `when` (gates offering the choice at all)
 *     and `duration: "turn"` (the override sweeps at end of turn instead of
 *     living forever, unlike Master of Wood, Water, or Hill td-136).
 *   - The legal-action emitter (`legal-actions/organization.ts`) now treats a
 *     region-transform effect as *combinable* with a cost-less, filter-only
 *     character target: it offers the plain character-only action AND, when
 *     the gate holds, additional (character × region) variants — instead of
 *     the old all-or-nothing "no match ⇒ whole card unplayable" behaviour
 *     used by td-136 (whose region-transform is its sole purpose).
 *   - `add-constraint`'s `character-stat-modifier` gained an
 *     `"all-matching-characters"` broadcast `target` mode (+ `filter`) for
 *     "the prowess of **each** Elf" — a short event never sits in
 *     `cardsInPlay`, so it cannot rely on `collectGlobalEffects` reading a
 *     plain `stat-modifier` off the card the way a long/permanent event
 *     would (Sun tw-335, Star of High Hope td-154). Implemented in both
 *     resolution paths: the ordinary inline short-event apply
 *     (`applyShortEventOnEntersPlay`, reducer-events.ts) for the plain
 *     no-region play, and the chain resolver
 *     (`applyShortEventSelfEntersPlayConstraints`, chain-reducer.ts) for the
 *     region-transform-combined play, which rides the chain (CoE 9.4/9.5).
 *
 * Playable: FULLY — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay,
  viableActions, findCharInstanceId, handCardId, getCharacter, baseProwess,
  dispatch, actionAs, resolveChain,
  makeMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, PlayShortEventAction, PlayHazardAction, CreatureKeyingMatch } from '../../index.js';

const EVENSTAR = 'tw-343' as CardDefinitionId;
const GALADRIEL = 'tw-153' as CardDefinitionId;
/** Man hazard-creature keyed to a single Border-land [{b}] — region type (also site-typed border-hold, unused here). */
const ABDUCTOR = 'tw-1' as CardDefinitionId;
/** Awakened Plant keyed to a single Wilderness [{w}] — region type (plus unrelated named sites/regions). */
const HUORN = 'tw-45' as CardDefinitionId;

function baseState(opts: { hand?: CardDefinitionId[]; withGoM?: boolean } = {}): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS, ARAGORN, GALADRIEL] }],
        hand: opts.hand ?? [EVENSTAR],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return opts.withGoM ? addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING) : state;
}

/** Every region type a hazard creature can currently be keyed by (region-type method only). */
function keyingRegionTypes(state: GameState, defId: CardDefinitionId): string[] {
  const inst = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
  return computeLegalActions(state, PLAYER_2)
    .filter(ea => ea.viable && ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst)
    .map(ea => (ea.action as PlayHazardAction).keyedBy)
    .filter((k): k is CreatureKeyingMatch => k?.method === 'region-type')
    .map(k => k.value)
    .sort();
}

describe('The Evenstar (tw-343)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1-2: base +1 prowess on one chosen Elf ──────────────────────────

  test('boosts one chosen Elf by +1 prowess, without Gates of Morning', () => {
    const state = baseState();
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
    });

    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 1);
    // A different Elf in the same company is untouched — the base clause
    // affects only the one chosen Elf.
    expect(getCharacter(s, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL));
  });

  test('only Elves are offered as the play-target (Aragorn, a Dúnadan, is not)', () => {
    const state = baseState();
    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(actions.some(a => a.targetCharacterId === aragornId)).toBe(false);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(actions.some(a => a.targetCharacterId === legolasId)).toBe(true);
  });

  test('not playable when no Elf is in any of the player\'s companies', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [EVENSTAR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ─── Rule 3: playable even with no matching region (CRF ruling) ───────────

  test('playable with no Gates of Morning in play at all (region choice never gates the card)', () => {
    const state = baseState();
    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBeGreaterThan(0);
  });

  // ─── Rules 4-7: Gates-of-Morning broadcast ─────────────────────────────────

  test('with Gates of Morning: the chosen Elf reaches +2, every other Elf gets +1, non-Elves untouched', () => {
    const state = baseState({ withGoM: true });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
    });

    // Chosen Elf: +1 (targeted) + +1 (broadcast) = +2.
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 2);
    // Other Elf in the same company: +1 (broadcast only).
    expect(getCharacter(s, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL) + 1);
    // Non-Elf (Dúnadan): untouched.
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN));
  });

  test('the broadcast reaches Elves on the opponent\'s side too (unqualified "each Elf")', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [EVENSTAR], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GALADRIEL] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoM = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const cardId = handCardId(withGoM, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(withGoM, RESOURCE_PLAYER, LEGOLAS);

    const s = dispatch(withGoM, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
    });

    expect(getCharacter(s, HAZARD_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL) + 1);
  });

  test('without Gates of Morning: other Elves are not boosted (broadcast does not fire)', () => {
    const state = baseState();
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
    });

    expect(getCharacter(s, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL));
  });

  // ─── Rule 8: region choice only offered with Gates of Morning ─────────────

  test('no region-transform action variants are offered without Gates of Morning', () => {
    const state = baseState();
    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action));
    expect(actions.every(a => a.targetRegionName === undefined)).toBe(true);
  });

  test('with Gates of Morning: region-transform variants (Rohan → free, Dunland → border) are offered alongside the plain action', () => {
    const state = baseState({ withGoM: true });
    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action));
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    // The plain (no region change) action for Legolas is still offered.
    expect(actions.some(a => a.targetCharacterId === legolasId && a.targetRegionName === undefined)).toBe(true);
    // Rohan is a printed Border-land: offered as b→f, paired with Legolas.
    expect(actions.some(a => a.targetCharacterId === legolasId && a.targetRegionName === 'Rohan' && a.newRegionType === 'free')).toBe(true);
    // Dunland is a printed Wilderness: offered as w→b, paired with Legolas.
    expect(actions.some(a => a.targetCharacterId === legolasId && a.targetRegionName === 'Dunland' && a.newRegionType === 'border')).toBe(true);
  });

  // ─── Rules 9-11: the region override itself, and its "until end of turn" duration ─

  test('choosing Rohan (Border-land → Free-domain) both boosts the Elf and installs a turn-scoped region override', () => {
    const state = baseState({ withGoM: true });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const s = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
      targetRegionName: 'Rohan',
      newRegionType: RegionType.Free,
    }));

    // The prowess boosts still apply — the region choice rides the chain but
    // does not replace the ordinary self-enters-play effects.
    expect(getCharacter(s, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 2);
    expect(getCharacter(s, RESOURCE_PLAYER, GALADRIEL).effectiveStats.prowess).toBe(baseProwess(GALADRIEL) + 1);

    const override = s.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && (c.kind as { attribute?: string }).attribute === 'region.type',
    );
    expect(override).toBeDefined();
    expect((override!.kind as { value?: string }).value).toBe('free');
    expect(((override!.kind as { filter?: Record<string, unknown> }).filter ?? {})['region.name']).toBe('Rohan');
    // Rule 11: unlike Master of Wood, Water, or Hill's permanent override,
    // this one is scoped to the turn.
    expect(override!.scope.kind).toBe('turn');

    // Card is spent (chain resolved to discard).
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(cardId);
  });

  test('a Border-land path stops keying as a Border-land once Rohan is transformed to a Free-domain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [EVENSTAR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [ABDUCTOR], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoM = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const cardId = handCardId(withGoM, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(withGoM, RESOURCE_PLAYER, LEGOLAS);

    const afterPlay = resolveChain(dispatch(withGoM, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
      targetRegionName: 'Rohan',
      newRegionType: RegionType.Free,
    }));

    // Move the hazard-facing state onto a company traversing Rohan.
    const onPath: GameState = {
      ...afterPlay,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Rohan'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    // Baseline sanity: before the override, Abductor keys to the printed
    // Border-land. (Recomputed against a fresh, un-overridden state.)
    const beforePath: GameState = { ...state, phaseState: onPath.phaseState };
    expect(keyingRegionTypes(beforePath, ABDUCTOR)).toEqual([RegionType.Border]);

    // Rohan is overridden to a Free-domain now: the Border-only Abductor
    // loses its region-type keying.
    expect(keyingRegionTypes(onPath, ABDUCTOR)).toEqual([]);
  });

  test('a Wilderness path stops keying as a Wilderness once Dunland is transformed to a Border-land', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [EVENSTAR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [HUORN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoM = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const cardId = handCardId(withGoM, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(withGoM, RESOURCE_PLAYER, LEGOLAS);

    const afterPlay = resolveChain(dispatch(withGoM, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetCharacterId: legolasId,
      targetRegionName: 'Dunland',
      newRegionType: RegionType.Border,
    }));

    const onPath: GameState = {
      ...afterPlay,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Dunland'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const beforePath: GameState = { ...state, phaseState: onPath.phaseState };
    expect(keyingRegionTypes(beforePath, HUORN)).toEqual([RegionType.Wilderness]);

    expect(keyingRegionTypes(onPath, HUORN)).toEqual([]);
  });

  // ─── Rule 12: cannot be duplicated (per turn) ──────────────────────────────

  test('cannot be duplicated: a second copy is not playable the same turn', () => {
    const state = baseState({ hand: [EVENSTAR, EVENSTAR] });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const firstId = handCardId(state, RESOURCE_PLAYER, 0);
    const secondId = handCardId(state, RESOURCE_PLAYER, 1);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: firstId,
      targetCharacterId: legolasId,
    });

    const actions = viableActions(s, PLAYER_1, 'play-short-event')
      .map(ea => actionAs<PlayShortEventAction>(ea.action));
    expect(actions.some(a => a.cardInstanceId === secondId)).toBe(false);
  });
});
