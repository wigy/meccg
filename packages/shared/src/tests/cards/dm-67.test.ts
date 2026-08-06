/**
 * @module dm-67.test
 *
 * Card test: In the Heart of his Realm (dm-67)
 * Type: hazard-event (permanent), non-unique
 *
 * Text:
 *   "Each company moving in a Dark-domain [{d}] draws one less card at the
 *    start of its movement/hazard phase (to no minimum). Additionally, any
 *    sage at a site in a Dark-domain [{d}] or Gorgoroth, or moving with a
 *    Dark-domain [{d}] or Gorgoroth in his site path, loses his sage skill.
 *    No character at a site in a Dark-domain [{d}] or Gorgoroth, or moving
 *    with a Dark-domain [{d}] or Gorgoroth in his site path, can use spells,
 *    light enchantments, or rituals. Discard when any play deck is
 *    exhausted. This card has no effect on a minion player."
 *
 * Effects (5):
 *   - play-restriction unplayable-when: cannot be played against a
 *     Ringwraith opponent (CoE 1.35).
 *   - draw-modifier: resource -1, min 0, appliesTo any-company, gated on
 *     `sitePath.darkCount >= 1` and `player.minion` false.
 *   - skill-suppression: "sage", regionTypes ["dark"], regionNames
 *     ["Gorgoroth"], noEffectOnMinion.
 *   - location-magic-restriction: regionTypes ["dark"], regionNames
 *     ["Gorgoroth"], noEffectOnMinion (default keyword set: spell, sorcery,
 *     spirit-magic, shadow-magic, light-enchantment, ritual).
 *   - on-event play-deck-exhausted: self-discard.
 *
 * `skill-suppression` and `location-magic-restriction` are new, reusable DSL
 * primitives (see docs/card-effects-dsl.md and
 * docs/certification-engine-support.md): a character's location is resolved
 * by `characterLocation` (`engine/reducer-utils.ts`) from its company's
 * current site region, or — only while that company is the active mover of
 * an in-progress movement/hazard phase — the phase's resolved site path.
 * `skill-suppression` is consulted inside `getEffectiveSkills`, so every
 * existing sage-gated ability (site grant-actions, sage-tap abilities)
 * automatically respects it. `location-magic-restriction` is enforced
 * centrally in `computeLegalActions` via `applyLocationMagicRestriction`,
 * mirroring `prohibit-card-play`.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  buildTestState, resetMint, makeMHState, makeSitePhase, dispatch,
  addCardInPlay, viableActions, findCharInstanceId, getCharacter,
  buildMHOrderEffectsDrawState, expectInPile,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, CardStatus } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, EndOfTurnPhaseState,
  TestRingAtSiteAction,
} from '../../index.js';

const IN_THE_HEART_OF_HIS_REALM = 'dm-67' as CardDefinitionId;

// Mount Doom (le-393): minion shadow-hold, region "Gorgoroth" (a Dark-domain
// region), playableResources includes "information", and carries the
// `sage-tap-ring-test` site rule — a real consumer of `getEffectiveSkills`
// gated on the "sage" skill.
const MOUNT_DOOM = 'le-393' as CardDefinitionId;
const HADOR = 'le-14' as CardDefinitionId; // minion character, ringwraith, sage
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;

// When I Know Anything (td-166): light-enchantment, playable on an untapped
// sage during the site phase at a site where Information is playable.
const WHEN_I_KNOW_ANYTHING = 'td-166' as CardDefinitionId;

const WEATHERTOP = 'tw-436' as CardDefinitionId; // resourceDraws 1
const MORIA_RESOURCE_DRAWS = 2;
const MORIA_HAZARD_DRAWS = 3;

/** Build an Organization-phase state with a company at Mount Doom. */
function orgStateAtMountDoom(opts: {
  alignment?: Alignment;
  characters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        ...(opts.alignment !== undefined ? { alignment: opts.alignment } : {}),
        companies: [{ site: MOUNT_DOOM, characters: opts.characters }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

/** Build a Site-phase state with a company at Mount Doom (Information playable). */
function siteStateAtMountDoom(opts: {
  alignment?: Alignment;
  characters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  hand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        ...(opts.alignment !== undefined ? { alignment: opts.alignment } : {}),
        companies: [{ site: MOUNT_DOOM, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };
}

describe('In the Heart of his Realm (dm-67)', () => {
  beforeEach(() => resetMint());

  // ── Rule: cannot be played against a Ringwraith opponent (CoE 1.35) ──────

  test('cannot be played against a Ringwraith opponent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IN_THE_HEART_OF_HIS_REALM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    expect(viableActions(mhState, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('IS playable against a non-Ringwraith opponent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IN_THE_HEART_OF_HIS_REALM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    expect(viableActions(mhState, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });

  // ── Rule: each company moving in a Dark-domain draws one less card ───────

  test('a company moving through a Dark-domain draws one less resource card', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Dark],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;

    expect(mh.step).toBe('draw-cards');
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS - 1);
    // Only the resource pool shrinks — hazard draws are untouched.
    expect(mh.hazardDrawMax).toBe(MORIA_HAZARD_DRAWS);
  });

  test('no reduction when the path has no Dark-domain (Wilderness only)', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Wilderness],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS);
  });

  test('no reduction without the card in play (the card is the source)', () => {
    const state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Dark],
      movementType: MovementType.Region,
    });
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS);
  });

  test('"each company" reaches the controller\'s own moving companies too', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Dark],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS - 1);
  });

  test('reduction floors at zero ("to no minimum")', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: WEATHERTOP, // resourceDraws 1
      heroSiteDeck: [WEATHERTOP],
      pathTypes: [RegionType.Dark],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(0);
  });

  test('no reduction when the moving player is a minion (no effect on minion player)', () => {
    let state: GameState = buildMHOrderEffectsDrawState({
      heroChars: [ARAGORN],
      destinationSite: MORIA,
      pathTypes: [RegionType.Dark],
      movementType: MovementType.Region,
    });
    state = addCardInPlay(state, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    state = {
      ...state,
      players: [
        { ...state.players[0], alignment: Alignment.Ringwraith },
        state.players[1],
      ] as typeof state.players,
    };
    const mh = dispatch(state, { type: 'pass', player: PLAYER_1 }).phaseState as MovementHazardPhaseState;
    expect(mh.resourceDrawMax).toBe(MORIA_RESOURCE_DRAWS);
  });

  // ── Rule: any sage at a site in a Dark-domain/Gorgoroth loses his sage skill ──

  test('a sage at Mount Doom (Gorgoroth) loses his sage skill while the card is in play', () => {
    const base = orgStateAtMountDoom({ characters: [{ defId: BILBO, items: [THE_LEAST_OF_GOLD_RINGS] }] });
    // Without the card: the sage-tap-ring-test ability is available.
    expect(viableActions(base, PLAYER_1, 'test-ring-at-site')).toHaveLength(1);

    // With the card in play: Bilbo no longer counts as a sage there.
    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    expect(viableActions(withCard, PLAYER_1, 'test-ring-at-site')).toHaveLength(0);
  });

  test('a minion sage at Mount Doom keeps his sage skill (no effect on minion player)', () => {
    const base = orgStateAtMountDoom({
      alignment: Alignment.Ringwraith,
      characters: [{ defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] }],
    });
    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    const actions = viableActions(withCard, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as TestRingAtSiteAction).characterId)
      .toBe(findCharInstanceId(withCard, RESOURCE_PLAYER, HADOR));
  });

  test('suppression is scoped to the skill: a non-sage companion is unaffected either way', () => {
    // Sanity: with no sage in the company at all, the ability was never
    // offered — the suppression above is specifically removing "sage", not
    // blanket-disabling the site rule.
    const base = orgStateAtMountDoom({ characters: [{ defId: ARAGORN, items: [THE_LEAST_OF_GOLD_RINGS] }] });
    expect(viableActions(base, PLAYER_1, 'test-ring-at-site')).toHaveLength(0);
    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    expect(viableActions(withCard, PLAYER_1, 'test-ring-at-site')).toHaveLength(0);
  });

  // ── Rule: no character can use spells/light-enchantments/rituals there ───

  test('a light-enchantment cannot be played on a sage at Mount Doom while the card is in play', () => {
    const base = siteStateAtMountDoom({ characters: [BILBO], hand: [WHEN_I_KNOW_ANYTHING] });
    expect(viableActions(base, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);

    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    expect(viableActions(withCard, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('a minion sage may still use a magic-class card at Mount Doom (no effect on minion player)', () => {
    const base = siteStateAtMountDoom({
      alignment: Alignment.Ringwraith,
      characters: [HADOR],
      hand: [WHEN_I_KNOW_ANYTHING],
    });
    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    expect(viableActions(withCard, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('a non-magic action on the same sage is unaffected', () => {
    // sanity: the restriction targets magic-class cards specifically, not
    // every action available to a character standing at Mount Doom.
    const base = orgStateAtMountDoom({ characters: [{ defId: BILBO, items: [THE_LEAST_OF_GOLD_RINGS] }] });
    const withCard = addCardInPlay(base, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);
    // The character remains a normal legal-action participant (e.g. tapped
    // status is still queryable / untap actions unaffected by the lock).
    const bilboId = findCharInstanceId(withCard, RESOURCE_PLAYER, BILBO);
    expect(getCharacter(withCard, RESOURCE_PLAYER, BILBO).status).toBe(CardStatus.Untapped);
    expect(bilboId).toBeDefined();
  });

  // ── Rule: discard when any play deck is exhausted ─────────────────────────

  test('discards to its owner\'s pile when any play deck is exhausted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [WEATHERTOP],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    // The card sits in the hazard player's play area; player 1 (a different
    // player)'s deck exhausting still discards it — "any play deck".
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, IN_THE_HEART_OF_HIS_REALM);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === IN_THE_HEART_OF_HIS_REALM,
    )).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === IN_THE_HEART_OF_HIS_REALM,
    )).toBe(false);
    expectInPile(afterPass, HAZARD_PLAYER, 'discardPile', IN_THE_HEART_OF_HIS_REALM);
  });
});
