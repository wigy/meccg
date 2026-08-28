/**
 * @module tw-363.test
 *
 * Card test: Wizard's Ring (tw-363)
 * Type: hero-resource-item (special, ring)
 *
 * Printed text:
 *   "Wizard only. Playable only at a Haven [{H}]. Cannot be stored, stolen,
 *    or transferred. Cannot be duplicated on a given Wizard. Bearer makes a
 *    corruption check when this item is played."
 *
 * Effects (data):
 *   1. item-play-site — playable only at a Haven (siteType filter)
 *   2. play-target (character) — bearer must be a Wizard
 *   3. duplication-limit (character, max 1) — cannot be duplicated on a
 *      given Wizard
 *   4. stat-modifier (direct-influence, +5) — per the authoritative card
 *      database's `directInfluence: "+5"` attribute, not stated in the
 *      printed text
 *   5. on-event self-enters-play → enqueue-corruption-check — bearer makes
 *      a corruption check when the item is played
 *   6. play-flag "no-transfer" / play-flag "no-store" — cannot be stored or
 *      transferred (the tw-227 Ent-draughts precedent). "Cannot be stolen"
 *      has no engine counterpart to gate: no mechanic in this codebase moves
 *      an item from one player's control to another's without the owning
 *      player's consent, so that clause is vacuously satisfied by the
 *      absence of any such mechanism.
 *
 * Regression: a Wizardhaven's `playableResources` list is printed empty
 * (Havens allow items only via each item's own site restriction), so
 * without an `item-play-site` effect the card was rejected everywhere,
 * including at a Haven with an untapped Wizard — reported for Lórien with
 * an untapped Gandalf.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN,
  LORIEN, MORIA, RIVENDELL, MINAS_TIRITH,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions,
  charIdAt, findCharInstanceId,
  getCharacter, attachItemToChar,
  RESOURCE_PLAYER,
  dispatch,
} from '../test-helpers.js';
import type {
  CardDefinitionId, TransferItemAction, StoreItemAction,
} from '../../index.js';
import { Phase, Alignment } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const WIZARDS_RING = 'tw-363' as CardDefinitionId;
/** Ordinary transferable/storable major item, for contrast. */
const GLAMDRING = 'tw-244' as CardDefinitionId;
/** Alatar — a Fallen-wizard avatar (race "fallen-wizard", not "wizard"). */
const ALATAR_FW = 'wh-1' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (siteType haven). */
const ISENGARD_FW = 'wh-56' as CardDefinitionId;

describe('Wizard’s Ring (tw-363)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Haven site restriction ─────────────────────────────────────

  test('playable at a Haven (Lórien) with an untapped Wizard', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [WIZARDS_RING],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeDefined();
  });

  test('NOT playable at a non-Haven (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [WIZARDS_RING],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: "Wizard only" bearer restriction ───────────────────────────

  test('NOT playable on a non-Wizard (Aragorn)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [WIZARDS_RING],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('playable on a Fallen-wizard player\'s Fallen-wizard avatar at a Wizardhaven (CoE g.wiz.F1: "Wizard" text refers to a Fallen-wizard player\'s Fallen-wizard avatar)', () => {
    // Bug report: Wizard's Ring was rejected everywhere for a Fallen-wizard
    // avatar (Alatar) at a Fallen-wizard Wizardhaven (Isengard), because the
    // bearer filter matched only race "wizard", not "fallen-wizard".
    const state = buildSitePhaseState({
      site: ISENGARD_FW,
      characters: [ALATAR_FW],
      hand: [WIZARDS_RING],
      alignment: Alignment.FallenWizard,
    });

    const alatarId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onAlatar = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === alatarId,
    );
    expect(onAlatar).toBeDefined();
  });

  test('mixed company: only offered on the Wizard, not the non-Wizard', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF, ARAGORN],
      hand: [WIZARDS_RING],
    });
    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const bearerIds = plays
      .filter(ea => ea.action.type === 'play-hero-resource')
      .map(ea => (ea.action as { attachToCharacterId: string }).attachToCharacterId);

    expect(bearerIds).toContain(gandalfId);
    expect(bearerIds).not.toContain(aragornId);
  });

  // ─── Rule 3: Duplication limit (one copy per Wizard) ────────────────────

  test('second copy NOT playable on the same Wizard already bearing one', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: GANDALF, items: [WIZARDS_RING] }],
      hand: [WIZARDS_RING],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeUndefined();
  });

  // ─── Rule 4: +5 direct influence ─────────────────────────────────────────

  test('bearer gets +5 direct influence', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: GANDALF, items: [WIZARDS_RING] }],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(15); // base 10 + 5
  });

  test('bearer gets the printed +2 prowess', () => {
    // Regression: the structural prowessModifier fallback was gated on the
    // item having NO stat-modifier DSL effect at all — Wizard's Ring declares
    // its +5 DI in DSL but its +2 prowess only structurally, so the blanket
    // any-stat check dropped the prowess bonus entirely. The gate must be
    // per-stat.
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: GANDALF, items: [WIZARDS_RING] }],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF).effectiveStats.prowess).toBe(8); // base 6 + 2
  });

  // ─── Rule 5: corruption check on play ───────────────────────────────────

  test('bearer makes a corruption check when Wizard’s Ring is played', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [WIZARDS_RING],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId,
    );
    expect(onGandalf).toBeDefined();

    const after = dispatch(state, onGandalf!.action);

    const corruptionChecks = after.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check',
    );
    expect(corruptionChecks).toHaveLength(1);
    const cc = corruptionChecks[0].kind as { characterId: unknown };
    expect(cc.characterId).toBe(gandalfId);
  });

  // ─── Rule 6: may not be transferred ─────────────────────────────────────

  test('is NOT offered by transfer-item, unlike an ordinary item on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGlamdring = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, GLAMDRING);
    const state = recomputeDerived(attachItemToChar(withGlamdring, RESOURCE_PLAYER, GANDALF, WIZARDS_RING));

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const glamdringId = state.players[RESOURCE_PLAYER].characters[gandalfId].items.find(i => i.definitionId === GLAMDRING)!.instanceId;
    const ringId = state.players[RESOURCE_PLAYER].characters[gandalfId].items.find(i => i.definitionId === WIZARDS_RING)!.instanceId;

    const transfers = viableActions(state, PLAYER_1, 'transfer-item').map(ea => ea.action as TransferItemAction);
    expect(transfers.some(a => a.itemInstanceId === glamdringId)).toBe(true);
    expect(transfers.some(a => a.itemInstanceId === ringId)).toBe(false);
  });

  // ─── Rule 7: may not be stored ──────────────────────────────────────────

  test('is NOT offered by store-item, unlike an ordinary item on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGlamdring = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, GLAMDRING);
    const state = recomputeDerived(attachItemToChar(withGlamdring, RESOURCE_PLAYER, GANDALF, WIZARDS_RING));

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const glamdringId = state.players[RESOURCE_PLAYER].characters[gandalfId].items.find(i => i.definitionId === GLAMDRING)!.instanceId;
    const ringId = state.players[RESOURCE_PLAYER].characters[gandalfId].items.find(i => i.definitionId === WIZARDS_RING)!.instanceId;

    const stores = viableActions(state, PLAYER_1, 'store-item').map(ea => ea.action as StoreItemAction);
    expect(stores.some(a => a.itemInstanceId === glamdringId)).toBe(true);
    expect(stores.some(a => a.itemInstanceId === ringId)).toBe(false);
  });
});
