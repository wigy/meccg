/**
 * @module wh-85.test
 *
 * Card test: Wizard's Trove (wh-85)
 * Type: minion-resource-event (permanent) · alignment: stage · stage points: 1
 *
 * Card text:
 *   "You may play The White Tree at one of your Wizardhavens [{H}] if Sapling
 *    of the White Tree is stored there. Place Wizard's Trove with The White
 *    Tree—which is worth full marshalling points. Your Wizardhaven [{H}]
 *    becomes protected. Ignore the text of The White Tree (including the
 *    Unique keyword). Alternatively, you may store one miscellaneous
 *    marshalling point card at one of your Wizardhavens [{H}]. Any reference
 *    to the site where the card can normally be stored are transferred
 *    instead to the Wizardhaven [{H}]. Place Wizard's Trove with the stored
 *    card—which is worth full marshalling points."
 *
 * Modelled as a Stage permanent event playable only in one of two combo modes
 * (organization phase, rule 5.F1 Stage timing):
 *  - Mode A `play-with-stored-card`: plays The White Tree from hand at a
 *    Wizardhaven (`siteFilter` `effectiveSiteType: haven`) where a Sapling of
 *    the White Tree is stored (`CardInstance.storedAtSite`, stamped by both
 *    store flows). Both cards enter play mutually `linkedInstanceId`-linked;
 *    the White Tree is `mpPinned` to its printed 5 misc MP
 *    (`fullMarshallingPoints`, beats the MEWH §4 flat-1 clamp) and
 *    `textIgnored` (`ignoreCardText` — its name leaves the in-play names
 *    list, so uniqueness does not bind). A `site-protected` constraint for
 *    the site is added for the controller (`siteBecomesProtected`).
 *  - Mode B `storage-site-transfer`: stores a bearer's `storable-at` item
 *    that scores its own storage MP (`marshallingPoints` override — the
 *    "miscellaneous marshalling point card" reading) at a Wizardhaven the
 *    item could not normally be stored at, with full store-item semantics
 *    (marshalling-point pile + initial-bearer corruption check). The trove
 *    enters play `attachedToStored`-linked to the stored card, which scores
 *    its full declared storage MP (no §4 clamp) while the link is live;
 *    `discardOrphanedStoredAttachedEvents` discards the trove if the stored
 *    card leaves the pile.
 *
 * | # | Rule                                                            | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | mode B: store a storable-MP card at one of your Wizardhavens    | OK     |
 * | 2 | mode B: not offered at a non-haven site / with no such card     | OK     |
 * | 3 | mode B: stored card is worth full MP (no MEWH §4 clamp)         | OK     |
 * | 4 | mode B: store-item semantics (MP pile, corruption check)        | OK     |
 * | 5 | mode A: play The White Tree at the Wizardhaven with Sapling     | OK     |
 * | 6 | mode A: not offered w/o stored Sapling there or White Tree      | OK     |
 * | 7 | mode A: White Tree worth full 5 misc MP (mpPinned)              | OK     |
 * | 8 | mode A: the Wizardhaven becomes protected                       | OK     |
 * | 9 | mode A: White Tree text/Unique ignored (not in in-play names)   | OK     |
 * |10 | "place with": trove linked to its combo piece; orphan sweep     | OK     |
 * |11 | contributes 1 stage point while in play                         | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, buildFallenWizardOrgPhaseState, dispatch, resolveChain, addToPile, charIdAt,
  viablePermanentEventPlays,
  ARAGORN, GLAMDRING, SAPLING_OF_THE_WHITE_TREE, LORIEN, MINAS_TIRITH,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, StoreItemAction,
} from '../../index.js';
import { isSiteProtectedForPlayer, discardOrphanedStoredAttachedEvents } from '../../engine/reducer-utils.js';
import { buildInPlayNames } from '../../engine/recompute-derived.js';

const WIZARDS_TROVE = 'wh-85' as CardDefinitionId;
const WHITE_TREE = 'tw-348' as CardDefinitionId;

const trovePlays = (state: GameState) =>
  viablePermanentEventPlays(state, PLAYER_1, RESOURCE_PLAYER, WIZARDS_TROVE);

describe("Wizard's Trove (wh-85)", () => {
  beforeEach(() => resetMint());

  // ── Mode B: storage-site transfer ──

  test('mode B offered: bearer of a storable-MP card at a Wizardhaven', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }],
      site: LORIEN,
      hand: [WIZARDS_TROVE],
    });
    const plays = trovePlays(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetSiteDefinitionId).toBe(LORIEN);
    expect(plays[0].storeCharacterId).toBe(charIdAt(state, RESOURCE_PLAYER));
    const sapling = state.players[RESOURCE_PLAYER].characters[charIdAt(state, RESOURCE_PLAYER)]
      .items.find(i => i.definitionId === SAPLING_OF_THE_WHITE_TREE)!;
    expect(plays[0].storeItemInstanceId).toBe(sapling.instanceId);
  });

  test('mode B not offered at a non-haven site (Minas Tirith)', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }],
      site: MINAS_TIRITH,
      hand: [WIZARDS_TROVE],
    });
    expect(trovePlays(state)).toHaveLength(0);
  });

  test('mode B not offered for a regular item without a storable-at MP override', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [GLAMDRING] }],
      site: LORIEN,
      hand: [WIZARDS_TROVE],
    });
    expect(trovePlays(state)).toHaveLength(0);
  });

  test('mode B resolution: stores the card at the Wizardhaven with full MP, corruption check, trove linked', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }],
      site: LORIEN,
      hand: [WIZARDS_TROVE],
    });
    const play = trovePlays(state)[0];
    const after = resolveChain(dispatch(state, play));

    // Sapling moved to the marshalling-point pile, stamped with the site.
    const stored = after.players[RESOURCE_PLAYER].killPile.find(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    );
    expect(stored).toBeDefined();
    expect(stored!.storedAtSite).toBe(LORIEN);

    // Trove entered play "with the stored card".
    const trove = after.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === WIZARDS_TROVE,
    );
    expect(trove).toBeDefined();
    expect(trove!.attachedToStored).toBe(stored!.instanceId);

    // Initial bearer makes a corruption check (store-item semantics).
    const cc = after.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();

    // Full marshalling points: the Sapling's declared 2 storage MP, exempt
    // from the MEWH §4 Fallen-wizard flat-1 clamp.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);

    // The trove contributes its stage point while in play.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  test('control: a plain store by a Fallen-wizard is clamped to 1 MP and stamps storedAtSite', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }],
      site: MINAS_TIRITH,
      hand: [],
    });
    const store = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(store).toHaveLength(1);
    const after = dispatch(state, store[0]);

    const stored = after.players[RESOURCE_PLAYER].killPile.find(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    );
    expect(stored!.storedAtSite).toBe(MINAS_TIRITH);
    // MEWH §4: without the trove's exemption the stored MP is clamped to 1.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('orphan sweep: trove is discarded when the stored card leaves the marshalling-point pile', () => {
    const state = buildFallenWizardOrgPhaseState({
      characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }],
      site: LORIEN,
      hand: [WIZARDS_TROVE],
    });
    const after = resolveChain(dispatch(state, trovePlays(state)[0]));
    const stored = after.players[RESOURCE_PLAYER].killPile.find(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    )!;

    // Simulate the stored card being displaced out of the pile.
    const players = after.players.map((p, i) => i === RESOURCE_PLAYER
      ? { ...p, killPile: p.killPile.filter(c => c.instanceId !== stored.instanceId) }
      : p) as unknown as typeof after.players;
    const swept = discardOrphanedStoredAttachedEvents({ ...after, players });

    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WIZARDS_TROVE)).toBeUndefined();
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WIZARDS_TROVE)).toBe(true);
  });

  // ── Mode A: play The White Tree at the Wizardhaven ──

  test('mode A offered when a Sapling is stored at a Wizardhaven and The White Tree is in hand', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE, WHITE_TREE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
      storedAtSite: LORIEN,
    });
    const plays = trovePlays(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetSiteDefinitionId).toBe(LORIEN);
    const whiteTree = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === WHITE_TREE)!;
    expect(plays[0].companionCardInstanceId).toBe(whiteTree.instanceId);
  });

  test('mode A not offered when the Sapling has no stored-site binding', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE, WHITE_TREE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
    });
    expect(trovePlays(state)).toHaveLength(0);
  });

  test('mode A not offered when the Sapling is stored at a non-haven site (Minas Tirith)', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE, WHITE_TREE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
      storedAtSite: MINAS_TIRITH,
    });
    expect(trovePlays(state)).toHaveLength(0);
  });

  test('mode A not offered when The White Tree is not in hand', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
      storedAtSite: LORIEN,
    });
    expect(trovePlays(state)).toHaveLength(0);
  });

  test('mode A resolution: White Tree enters play at full 5 misc MP, text ignored, site protected, cards linked', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE, WHITE_TREE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
      storedAtSite: LORIEN,
    });
    const after = resolveChain(dispatch(state, trovePlays(state)[0]));

    const whiteTree = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WHITE_TREE);
    const trove = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WIZARDS_TROVE);
    expect(whiteTree).toBeDefined();
    expect(trove).toBeDefined();

    // "Place Wizard's Trove with The White Tree" — mutual link.
    expect(whiteTree!.linkedInstanceId).toBe(trove!.instanceId);
    expect(trove!.linkedInstanceId).toBe(whiteTree!.instanceId);

    // "worth full marshalling points" — printed 5 misc MP, pinned past the
    // MEWH §4 Fallen-wizard flat-1 clamp.
    expect(whiteTree!.mpPinned).toBe(5);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(5);

    // "Your Wizardhaven becomes protected."
    expect(isSiteProtectedForPlayer(after, LORIEN, PLAYER_1)).toBe(true);

    // "Ignore the text of The White Tree (including the Unique keyword)" —
    // the card is in play but its name is not, so uniqueness does not bind
    // and its Minas-Tirith-becomes-a-Haven text never applies.
    expect(whiteTree!.textIgnored).toBe(true);
    expect(buildInPlayNames(after)).not.toContain('The White Tree');

    // The Sapling stays stored (the trove's condition is not a discard cost).
    expect(after.players[RESOURCE_PLAYER].killPile.some(
      c => c.definitionId === SAPLING_OF_THE_WHITE_TREE,
    )).toBe(true);

    // Stage point from the trove.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  test('mode A protection is cleared when the trove leaves play', () => {
    let state = buildFallenWizardOrgPhaseState({
      characters: [ARAGORN],
      site: LORIEN,
      hand: [WIZARDS_TROVE, WHITE_TREE],
    });
    state = addToPile(state, RESOURCE_PLAYER, 'killPile', {
      instanceId: 'p1-stored-sapling' as CardInstanceId,
      definitionId: SAPLING_OF_THE_WHITE_TREE,
      storedAtSite: LORIEN,
    });
    const after = resolveChain(dispatch(state, trovePlays(state)[0]));
    const trove = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WIZARDS_TROVE)!;

    // The site-protected constraint is sourced from the trove instance, so
    // the standard source-removal cleanup clears it with the card.
    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'site-flag' && c.kind.flag === 'site-protected',
    );
    expect(constraint).toBeDefined();
    expect(constraint!.source).toBe(trove.instanceId);
  });
});
