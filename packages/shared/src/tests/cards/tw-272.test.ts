/**
 * @module tw-272.test
 *
 * Card test: Magic Ring of Lore (tw-272)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, magic-ring
 *
 * "Magic Ring. Playable only with a gold ring and after a test indicates a
 *  Magic Ring. Gives the bearer sage skill. If the bearer is already a
 *  sage, he may tap to use a Palantír. Cannot be duplicated on a given
 *  character."
 *
 * Effects & engine support:
 * | # | Rule                                                    | Mechanism                                                       |
 * |---|-----------------------------------------------------------|--------------------------------------------------------------------|
 * | 1 | Eligible as ring-test replacement for matching roll        | keyword magic-ring matched against test table                     |
 * | 2 | Gives the bearer sage skill                                 | grant-skill effect + getEffectiveSkills()                          |
 * | 3 | Natural sage bearing a Palantír may tap to use it           | grant-action, targets scope bearer-items (palantir keyword),      |
 * |   |                                                             |   when bearer.skills $includes sage, apply add-constraint          |
 * |   |                                                             |   can-use-palantir sourceFrom action-target                        |
 * | 4 | Bearer who is only a sage via the ring's own grant may NOT  | when condition reads printed skills only (grant-action context)   |
 * |   |   use this ability                                         |                                                                     |
 * | 5 | Cannot be duplicated on a given character                   | duplication-limit scope:character max:1                            |
 *
 * New engine mechanism (this certification): a `bearer-items` grant-action
 * target scope (items borne by the activating character only — unlike the
 * pre-existing company-wide `company-items`) plus an `add-constraint`
 * `sourceFrom: "action-target"`, which sources the resulting constraint from
 * the activation's chosen target card (the bearer's own Palantír) instead of
 * the granting card (the ring). This is needed because, unlike Palantír of
 * Elostirion (le-332) — which grants the use of *itself* — this ring grants
 * the use of a *different* card the bearer separately holds, so the
 * `can-use-palantir` constraint must be scoped to that Palantír's own
 * instance for `buildGrantActionContext`'s `constraint.source ===
 * sourceInstanceId` match to see it.
 *
 * Character selection:
 * - ELROND (tw-145): warrior+sage+diplomat — natural sage, used for Rule 3.
 * - ARAGORN (tw-120): warrior+scout+ranger, NOT a sage — used for Rules 2 and 4.
 *
 * Fixtures reuse existing hero Palantír items — Palantír of Annúminas
 * (tw-297) and Palantír of Amon Sûl (tw-296), each carrying its own
 * `bearer.canUsePalantir`-gated grant-action — to verify the constraint
 * genuinely unlocks a real Palantír's abilities and stays scoped to the one
 * Palantír chosen when the bearer carries two.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, ActivateGrantedAction, GameState } from '../../index.js';
import type { PlayShortEventAction } from '../../types/actions-short-event.js';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, ELROND,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  PRECIOUS_GOLD_RING,
  Phase, CardStatus,
  buildTestState, resetMint, makePlayDeck,
  findCharInstanceId, getCharacter, viableActions, dispatch,
  attachItemToChar, addCardToHand, enqueueGoldRingTest,
} from '../test-helpers.js';

const MAGIC_RING_OF_LORE = 'tw-272' as CardDefinitionId;
const USE_PALANTIR = 'tw-355' as CardDefinitionId; // sage-only, play-target filter target.skills $includes sage
const ANNUMINAS = 'tw-297' as CardDefinitionId; // Palantír with its own bearer.canUsePalantir-gated grant-action
const AMON_SUL = 'tw-296' as CardDefinitionId; // second Palantír, own bearer.canUsePalantir-gated grant-action

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

/** Hero organization-phase state; PLAYER_1's company bears the given items. */
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
            items: opts.items ?? [MAGIC_RING_OF_LORE],
            status: opts.bearerTapped ? CardStatus.Tapped : CardStatus.Untapped,
          }],
        }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

describe('Magic Ring of Lore (tw-272)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: gold-ring-test eligibility (also exercises the magic-ring keyword fix) ──

  test('magic-ring offered when roll total matches magic-ring range (1–5 on Precious Gold Ring)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_LORE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });

  test('magic-ring NOT offered when roll total is outside magic-ring range', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_LORE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  test('magic-ring played via test: moves from hand onto the character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_LORE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_LORE)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === MAGIC_RING_OF_LORE),
    ).toBeDefined();
  });

  // ── Rule 2: gives the bearer sage skill ───────────────────────────────

  test('non-sage bearer (Aragorn) counts as sage for Use Palantír targeting when ring + Palantír held', () => {
    // Aragorn (tw-120) is warrior+scout+ranger, not a sage. With the ring and
    // a borne Palantír, he should satisfy Use Palantír's play-target filter
    // (target.skills $includes sage AND target.itemKeywords $includes palantir).
    const state = buildOrgState({ bearer: ARAGORN, items: [MAGIC_RING_OF_LORE, ANNUMINAS] });
    const withHand = addCardToHand(state, RESOURCE_PLAYER, USE_PALANTIR);

    const actions = viableActions(withHand, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.length).toBe(1);
  });

  test('non-sage without the ring (Aragorn): Use Palantír not playable', () => {
    const state = buildOrgState({ bearer: ARAGORN, items: [ANNUMINAS] });
    const withHand = addCardToHand(state, RESOURCE_PLAYER, USE_PALANTIR);

    expect(viableActions(withHand, PLAYER_1, 'play-short-event').length).toBe(0);
  });

  // ── Rule 3: a natural sage bearing a Palantír may tap to use it ─────────

  test('a natural sage bearer (Elrond) bearing a Palantír may tap to enable it', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS] });

    expect(grantActions(state, 'magic-ring-of-lore-use-palantir').length).toBe(1);
  });

  test('a natural sage bearer with no Palantír is NOT offered the ability', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE] });

    expect(grantActions(state, 'magic-ring-of-lore-use-palantir').length).toBe(0);
  });

  test('the ability is NOT offered while the bearer is already tapped', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS], bearerTapped: true });

    expect(grantActions(state, 'magic-ring-of-lore-use-palantir').length).toBe(0);
  });

  test('activating taps the bearer (not the ring or the Palantír) and adds a can-use-palantir constraint sourced from the Palantír', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS] });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const annuminasId = getCharacter(state, RESOURCE_PLAYER, ELROND).items
      .find(i => i.definitionId === ANNUMINAS)!.instanceId;

    const after = dispatch(state, grantActions(state, 'magic-ring-of-lore-use-palantir')[0]);

    expect(after.players[0].characters[elrondId].status).toBe(CardStatus.Tapped);
    for (const item of after.players[0].characters[elrondId].items) {
      expect(item.status).toBe(CardStatus.Untapped);
    }

    const constraint = after.activeConstraints.find(c => c.kind.type === 'can-use-palantir');
    expect(constraint).toBeDefined();
    expect(constraint!.target).toEqual({ kind: 'character', characterId: elrondId });
    expect(constraint!.source).toBe(annuminasId);
  });

  test('the enabled Palantír’s own tap ability becomes available afterward', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS] });

    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(0);

    const after = dispatch(state, grantActions(state, 'magic-ring-of-lore-use-palantir')[0]);

    expect(grantActions(after, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  test('a sage bearing two Palantíri is offered one activation per item', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS, AMON_SUL] });

    const actions = grantActions(state, 'magic-ring-of-lore-use-palantir');
    expect(actions.length).toBe(2);
    const targetIds = new Set(actions.map(a => a.targetCardId));
    expect(targetIds.size).toBe(2);
  });

  test('enabling one Palantír does not enable the other the same bearer holds', () => {
    const state = buildOrgState({ bearer: ELROND, items: [MAGIC_RING_OF_LORE, ANNUMINAS, AMON_SUL] });
    const annuminasId = getCharacter(state, RESOURCE_PLAYER, ELROND).items
      .find(i => i.definitionId === ANNUMINAS)!.instanceId;

    const activations = grantActions(state, 'magic-ring-of-lore-use-palantir');
    const focusAnnuminas = activations.find(a => a.targetCardId === annuminasId)!;
    const after = dispatch(state, focusAnnuminas);

    expect(grantActions(after, 'annuminas-fetch-sage-only').length).toBe(1);
    expect(grantActions(after, 'amon-sul-peek-hand').length).toBe(0);
  });

  // ── Rule 4: bearer who is only a sage via this ring's own grant may NOT use the ability ──

  test('a bearer who is only a sage via the ring itself (Aragorn) may NOT tap to use a Palantír', () => {
    // Aragorn is NOT a natural sage. The ring grants sage for targeting
    // purposes but the grant-action's `when` condition reads printed skills
    // only (bearer.skills in the grant-action context is charDef.skills).
    const state = buildOrgState({ bearer: ARAGORN, items: [MAGIC_RING_OF_LORE, ANNUMINAS] });

    expect(grantActions(state, 'magic-ring-of-lore-use-palantir').length).toBe(0);
  });

  // ── Rule 5: cannot be duplicated on a given character ────────────────────

  test('a character already bearing a copy is not offered a second one after the gold-ring test', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withExistingRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_LORE);
    const withGoldRing = attachItemToChar(withExistingRing, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === PRECIOUS_GOLD_RING)!.instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, MAGIC_RING_OF_LORE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });
});
