/**
 * @module dm-174.test
 *
 * Card test: Necklace of Girion (dm-174)
 * Type: hero-resource-item (special), alignment wizard, unique.
 * Marshalling Points: 4. Corruption Points: 3.
 *
 * Card text: "Unique. Only playable at The Lonely Mountain. Bearer receives
 * +3 direct influence against Dwarves/Men and Dwarf/Man factions. If bearer
 * is at a Free-hold [{F}] or Border-hold [{B}], he can make a corruption
 * check, and, if successful, you may discard Necklace of Girion to play any
 * non-special item from your hand with its bearer."
 *
 * Rule coverage:
 *
 * | # | Rule                                            | Mechanism                                                         |
 * |---|--------------------------------------------------|--------------------------------------------------------------------|
 * | 1 | Only playable at The Lonely Mountain              | `item-play-site` `sites: ["The Lonely Mountain"]`                  |
 * | 2 | +3 DI vs Dwarves/Men (follower control)           | `stat-modifier` direct-influence, `reason: influence-check`        |
 * | 3 | +3 DI vs Dwarves/Men (opponent-influence attempt) | `stat-modifier` direct-influence, `reason: opponent-influence-check`|
 * | 4 | +3 DI vs Dwarf/Man factions                       | `stat-modifier` direct-influence, `reason: faction-influence-check`|
 * | 5 | Corruption check at a Free-hold/Border-hold       | `grant-action` (cost {}), `when bearer.siteType $in [free-hold, border-hold]`, `apply enqueue-corruption-check` |
 * | 6 | If successful, discard to play a non-special item | `onSuccess: enqueue-item-placement-offer` → `item-placement-offer` pending resolution |
 *
 * Fixtures (hero side):
 *   FARAMIR (tw-149): dúnadan, mind 5, prowess 5, DI 1 — neutral bearer (no
 *     corruption-check modifiers, not Dwarf/Man/Elf) of Necklace of Girion.
 *   BOFUR (tw-132): dwarf, mind 2 — Dwarf follower-control / opponent-influence target.
 *   BARD_BOWMAN (tw-124): man, mind 2, DI 0 — Man follower-control target.
 *   LEGOLAS (tw-168): elf, mind 6 — non-Dwarf/Man control target (no bonus).
 *   BLUE_MOUNTAIN_DWARVES (tw-200): Dwarf faction, influence# 10, playable at
 *     BLUE_MOUNTAIN_DWARF_HOLD.
 *   MEN_OF_ANORIEN (tw-277): Man faction, influence# 8, playable at MINAS_TIRITH.
 *   WOOD_ELVES (tw-367): Elf faction, influence# 9, playable at THRANDUILS_HALLS
 *     — negative case (no bonus).
 *   EDORAS (tw-394): free-hold. BREE (tw-378): border-hold. RIVENDELL: haven
 *     (negative case for both the item-play-site and grant-action gates).
 *   LONELY_MOUNTAIN (tw-428): ruins-and-lairs — Necklace of Girion's only
 *     playable site.
 *   DAGGER_OF_WESTERNESSE (tw-206): minor, non-special item — placement candidate.
 *   PALANTIR_OF_ORTHANC (tw-300): special item — excluded from the placement offer.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, Alignment,
  FARAMIR, LEGOLAS,
  BLUE_MOUNTAIN_DWARVES, MEN_OF_ANORIEN, WOOD_ELVES,
  BLUE_MOUNTAIN_DWARF_HOLD, MINAS_TIRITH, THRANDUILS_HALLS,
  EDORAS, BREE, RIVENDELL,
  DAGGER_OF_WESTERNESSE, PALANTIR_OF_ORTHANC,
  resetMint, buildTestState, buildSitePhaseState,
  findCharInstanceId, findHandCardId, viableActions, dispatch,
  grantedActionsFor, executeAction, firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  makeSitePhase, pool, CardStatus,
} from '../test-helpers.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import type { CardDefinitionId, CardInstanceId, CharacterCard, GameState } from '../../index.js';

const NECKLACE_OF_GIRION = 'dm-174' as CardDefinitionId;
const BOFUR = 'tw-132' as CardDefinitionId;        // dwarf, mind 2
const BARD_BOWMAN = 'tw-124' as CardDefinitionId;  // man, mind 2, DI 0
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('Necklace of Girion (dm-174)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Only playable at The Lonely Mountain ────────────────────────

  test('playable at The Lonely Mountain during the site phase', () => {
    const state = buildSitePhaseState({ site: LONELY_MOUNTAIN, characters: [FARAMIR], hand: [NECKLACE_OF_GIRION] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('NOT playable at Rivendell (a Haven)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [FARAMIR], hand: [NECKLACE_OF_GIRION] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('NOT playable at Edoras (a Free-hold)', () => {
    const state = buildSitePhaseState({ site: EDORAS, characters: [FARAMIR], hand: [NECKLACE_OF_GIRION] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 2: +3 DI vs Dwarves/Men (follower control) ─────────────────────

  function diTestState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BREE, characters: [LEGOLAS] }], hand: [], siteDeck: [EDORAS] },
      ],
    });
  }

  test('+3 DI for the bearer against a Dwarf follower target', () => {
    const state = diTestState();
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const bofurDef = pool[BOFUR as string] as CharacterCard;
    expect(availableDI(state, faramirId, state.players[RESOURCE_PLAYER], bofurDef)).toBe(4); // base 1 + 3
    expect(availableDI(state, faramirId, state.players[RESOURCE_PLAYER])).toBe(1);
  });

  test('+3 DI for the bearer against a Man follower target', () => {
    const state = diTestState();
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const bardDef = pool[BARD_BOWMAN as string] as CharacterCard;
    expect(availableDI(state, faramirId, state.players[RESOURCE_PLAYER], bardDef)).toBe(4); // base 1 + 3
  });

  test('no bonus against a non-Dwarf/non-Man follower target (Elf)', () => {
    const state = diTestState();
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;
    expect(availableDI(state, faramirId, state.players[RESOURCE_PLAYER], legolasDef)).toBe(1); // base only
  });

  // ── Rule 3: +3 DI vs Dwarves/Men (opponent-influence attempt) ───────────

  test('+3 DI on an opponent-influence attempt against a Dwarf character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [BOFUR] }], hand: [], siteDeck: [BREE] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const bofurId = findCharInstanceId(state, HAZARD_PLAYER, BOFUR);

    const attempt = firstOpponentInfluenceAttempt(state, bofurId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const after = dispatch(state, attempt!);
    const pending = after.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.influencerDI).toBe(4); // base 1 + 3
  });

  // ── Rule 4: +3 DI vs Dwarf/Man factions ──────────────────────────────────

  test('+3 DI toward a Dwarf faction influence attempt', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] }], hand: [BLUE_MOUNTAIN_DWARVES], siteDeck: [EDORAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [LEGOLAS] }], hand: [], siteDeck: [BREE] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // influence# 10, Faramir DI 1 + 3 (Dwarf faction) = 4 → need = 10 - 4 = 6.
    expect(attempt!.need).toBe(6);
  });

  test('+3 DI toward a Man faction influence attempt', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] }], hand: [MEN_OF_ANORIEN], siteDeck: [EDORAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [LEGOLAS] }], hand: [], siteDeck: [BREE] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // influence# 8, Faramir DI 1 + 3 (Man faction) = 4, plus Men of Anórien's
    // own +1 Dúnedain Standard Modification (Faramir is a dúnadan) → need = 8 - 4 - 1 = 3.
    expect(attempt!.need).toBe(3);
  });

  test('no bonus toward a non-Dwarf/non-Man faction influence attempt (Elf)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: THRANDUILS_HALLS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] }], hand: [WOOD_ELVES], siteDeck: [EDORAS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: EDORAS, characters: [LEGOLAS] }], hand: [], siteDeck: [BREE] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // influence# 9, Faramir DI 1 (no bonus) → need = 9 - 1 = 8.
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 5: corruption check offered only at a Free-hold/Border-hold ────

  test('corruption-check grant-action offered when bearer is at a Free-hold', () => {
    const state = buildSitePhaseState({ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    expect(grantedActionsFor(state, faramirId, 'necklace-of-girion-corruption-check', PLAYER_1)).toHaveLength(1);
  });

  test('corruption-check grant-action offered when bearer is at a Border-hold', () => {
    const state = buildSitePhaseState({ site: BREE, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    expect(grantedActionsFor(state, faramirId, 'necklace-of-girion-corruption-check', PLAYER_1)).toHaveLength(1);
  });

  test('corruption-check grant-action NOT offered at a Haven', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    expect(grantedActionsFor(state, faramirId, 'necklace-of-girion-corruption-check', PLAYER_1)).toHaveLength(0);
  });

  test('corruption-check grant-action NOT offered at The Lonely Mountain (Ruins & Lairs)', () => {
    const state = buildSitePhaseState({ site: LONELY_MOUNTAIN, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    expect(grantedActionsFor(state, faramirId, 'necklace-of-girion-corruption-check', PLAYER_1)).toHaveLength(0);
  });

  // ── Rule 6: successful check unlocks the item-placement offer ───────────

  function activateCheck(state: GameState): GameState {
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const action = grantedActionsFor(state, faramirId, 'necklace-of-girion-corruption-check', PLAYER_1)[0];
    expect(action).toBeDefined();
    return dispatch(state, action);
  }

  test('activating enqueues a corruption check on the bearer, not immediately an item-placement-offer', () => {
    const state = buildSitePhaseState({ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    const after = activateCheck(state);

    const cc = after.pendingResolutions.find(r => r.kind.type === 'corruption-check' && r.kind.characterId === faramirId);
    expect(cc).toBeDefined();
    expect(after.pendingResolutions.some(r => r.kind.type === 'item-placement-offer')).toBe(false);
  });

  test('passing the corruption check enqueues an item-placement-offer targeting the bearer', () => {
    const state = buildSitePhaseState({ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const necklaceId = state.players[RESOURCE_PLAYER].characters[faramirId].items[0].instanceId;

    const afterActivate = activateCheck(state);
    // Faramir's only corruption source is Necklace of Girion's printed 3 CP;
    // a roll of 12 clears it cleanly (12 > 3).
    const afterCC = executeAction(afterActivate, PLAYER_1, 'corruption-check', 12);

    const offer = afterCC.pendingResolutions.find(r => r.kind.type === 'item-placement-offer');
    expect(offer).toBeDefined();
    if (offer?.kind.type !== 'item-placement-offer') throw new Error('no item-placement-offer pending');
    expect(offer.kind.characterInstanceId).toBe(faramirId);
    expect(offer.source).toBe(necklaceId);
  });

  test('failing the corruption check does NOT enqueue an item-placement-offer', () => {
    const state = buildSitePhaseState({ site: EDORAS, characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }] });

    const afterActivate = activateCheck(state);
    // cp = 3 (Necklace only); a roll of 2 (== cp - 1) fails the check.
    const afterCC = executeAction(afterActivate, PLAYER_1, 'corruption-check', 2);

    expect(afterCC.pendingResolutions.some(r => r.kind.type === 'item-placement-offer')).toBe(false);
  });

  // ── item-placement-offer resolution ──────────────────────────────────────

  function readyOfferState(): GameState {
    const state = buildSitePhaseState({
      site: EDORAS,
      characters: [{ defId: FARAMIR, items: [NECKLACE_OF_GIRION] }],
      hand: [DAGGER_OF_WESTERNESSE, PALANTIR_OF_ORTHANC],
    });
    const afterActivate = activateCheck(state);
    return executeAction(afterActivate, PLAYER_1, 'corruption-check', 12);
  }

  test('offers each non-special hand item plus a decline, excluding special-subtype items', () => {
    const state = readyOfferState();
    const daggerId = findHandCardId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const palantirId = findHandCardId(state, RESOURCE_PLAYER, PALANTIR_OF_ORTHANC);

    const offers = viableActions(state, PLAYER_1, 'play-item-placement-offer');
    const offeredIds = offers.map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(offeredIds).toContain(daggerId);
    expect(offeredIds).not.toContain(palantirId);

    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  test('accepting discards Necklace of Girion and attaches the chosen item to the bearer, untapped', () => {
    const state = readyOfferState();
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const necklaceId = state.players[RESOURCE_PLAYER].characters[faramirId].items
      .find(i => i.definitionId === NECKLACE_OF_GIRION)!.instanceId;
    const daggerId = findHandCardId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);

    const action = viableActions(state, PLAYER_1, 'play-item-placement-offer')
      .find(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === daggerId)!.action;
    const after = dispatch(state, action);

    const items = after.players[RESOURCE_PLAYER].characters[faramirId].items;
    expect(items.some(i => i.instanceId === necklaceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === necklaceId)).toBe(true);

    const dagger = items.find(i => i.definitionId === DAGGER_OF_WESTERNESSE);
    expect(dagger).toBeDefined();
    expect(dagger!.status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === daggerId)).toBe(false);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('declining leaves Necklace of Girion in place and the hand unchanged', () => {
    const state = readyOfferState();
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const necklaceId = state.players[RESOURCE_PLAYER].characters[faramirId].items
      .find(i => i.definitionId === NECKLACE_OF_GIRION)!.instanceId;
    const handBefore = state.players[RESOURCE_PLAYER].hand.length;

    const passAction = viableActions(state, PLAYER_1, 'pass')[0].action;
    const after = dispatch(state, passAction);

    expect(after.players[RESOURCE_PLAYER].characters[faramirId].items.some(i => i.instanceId === necklaceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(handBefore);
    expect(after.pendingResolutions).toHaveLength(0);
  });
});
