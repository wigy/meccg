/**
 * @module tw-355.test
 *
 * Card test: Use Palantír (tw-355)
 * Type: hero-resource-event (short), alignment wizard. Keywords: sage-only.
 *
 * "Sage only. Tap sage to enable him to use one Palantír he bears for the
 *  rest of the turn."
 *
 * Effects & engine support:
 * | # | Rule                                                | Mechanism                                                      |
 * |---|------------------------------------------------------|-----------------------------------------------------------------|
 * | 1 | Playable only on a sage bearing a Palantír            | play-target character, filter target.skills $includes sage AND  |
 * |   |                                                        |   target.itemKeywords $includes palantir, cost tap character    |
 * | 2 | "One Palantír he bears" — a bearer of several picks   | itemFilter { keywords $includes palantir } — one legal action    |
 * |   |   which one the card resolves against                | per (sage, item) pair, carried as targetItemInstanceId           |
 * | 3 | Tapping the sage enables him to use that Palantír     | on-event self-enters-play → add-constraint can-use-palantir      |
 * |   |   for the rest of the turn                            |   (scope turn), source = the chosen item's own instance          |
 *
 * The `can-use-palantir` constraint's `source` is bound to the chosen item
 * instance (not the event card itself), reusing `buildGrantActionContext`'s
 * existing `constraint.source === sourceInstanceId` match unmodified — so
 * enabling one Palantír never leaks to another the same sage bears, exactly
 * like Palantír of Elostirion's (le-332) own "this Palantír" grant-action.
 *
 * Fixtures (hero, per the card's wizard alignment):
 *   ELROND (tw-145)    - hero sage, no native can-use-palantir
 *   ARAGORN (tw-120)   - hero non-sage, proves the sage-only gate
 *   ANNUMINAS (tw-297) - Palantír with a bearer.canUsePalantir-gated grant-action
 *   AMON_SUL (tw-296)  - second Palantír, own bearer.canUsePalantir-gated grant-action
 *   LORIEN (tw-408)    - hero site
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus,
  CardDefinitionId,
  ARAGORN, LEGOLAS, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId, getCharacter,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import type { PlayShortEventAction } from '../../types/actions-short-event.js';

const USE_PALANTIR = 'tw-355' as CardDefinitionId;
const ELROND = 'tw-145' as CardDefinitionId; // hero sage, no native can-use-palantir
const ANNUMINAS = 'tw-297' as CardDefinitionId;
const AMON_SUL = 'tw-296' as CardDefinitionId;

/**
 * Hero organization-phase state; PLAYER_1's company bears the given items.
 * Organization is where CoE rule 2.1.1's "any phase" resource short-events
 * actually combo with a Palantír's own grant-action (org-phase-only), so
 * that's where Use Palantír needs to be legal for the card to be useful.
 */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  items?: CardDefinitionId[];
  bearerTapped?: boolean;
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: LORIEN,
          characters: [{
            defId: opts.bearer ?? ELROND,
            items: opts.items ?? [ANNUMINAS],
            status: opts.bearerTapped ? CardStatus.Tapped : CardStatus.Untapped,
          }],
        }],
        hand: [USE_PALANTIR],
        siteDeck: [MINAS_TIRITH],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Use Palantír (tw-355)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target (sage bearing a Palantír, tap cost) ──

  test('playable on a sage bearing a Palantír', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS] });

    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayShortEventAction;
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.targetItemInstanceId).toBeDefined();
  });

  test('NOT playable when the bearer is not a sage', () => {
    const state = buildOrgState({ bearer: ARAGORN, items: [ANNUMINAS] });

    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(0);
  });

  test('NOT playable when the sage bears no Palantír', () => {
    const state = buildOrgState({ bearer: ELROND, items: [] });

    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(0);
  });

  test('NOT playable when the sage is already tapped', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS], bearerTapped: true });

    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(0);
  });

  // ── Effect 2/3: resolving taps the sage and enables the chosen Palantír ──

  test('resolving taps the sage and adds a can-use-palantir constraint sourced from the chosen item', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS] });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const itemInstanceId = getCharacter(state, RESOURCE_PLAYER, ELROND).items[0].instanceId;

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    expect(after.players[0].characters[elrondId].status).toBe(CardStatus.Tapped);
    const constraint = after.activeConstraints.find(c => c.kind.type === 'can-use-palantir');
    expect(constraint).toBeDefined();
    expect(constraint!.target).toEqual({ kind: 'character', characterId: elrondId });
    expect(constraint!.source).toBe(itemInstanceId);

    // The card itself is spent (discarded), not left in hand.
    expect(after.players[0].hand.some(c => c.definitionId === USE_PALANTIR)).toBe(false);
  });

  test('the enabled Palantír’s own tap ability becomes available after playing Use Palantír', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS] });

    // Before: Annúminas' own fetch ability is not offered.
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(0);

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    expect(grantActions(after, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  // ── "One Palantír he bears": a sage with two Palantíri must choose ──

  test('a sage bearing two Palantíri is offered one legal action per item', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS, AMON_SUL] });

    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.length).toBe(2);
    const itemIds = new Set(actions.map(a => a.targetItemInstanceId));
    expect(itemIds.size).toBe(2);
  });

  test('enabling one Palantír does not enable the other the same sage bears', () => {
    const state = buildOrgState({ bearer: ELROND, items: [ANNUMINAS, AMON_SUL] });
    const annuminasId = getCharacter(state, RESOURCE_PLAYER, ELROND).items
      .find(i => i.definitionId === ANNUMINAS)!.instanceId;

    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    const focusAnnuminas = actions.find(a => a.targetItemInstanceId === annuminasId)!;

    const after = dispatch(state, focusAnnuminas);

    // Annúminas' own ability is now available; Amon Sûl's is not.
    expect(grantActions(after, 'annuminas-fetch-sage-only').length).toBe(1);
    expect(grantActions(after, 'amon-sul-peek-hand').length).toBe(0);
  });
});
