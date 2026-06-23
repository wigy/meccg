/**
 * @module wh-117.test
 *
 * Card test: The Forge-master (wh-117)
 * Type: minion-resource-event (permanent), alignment "stage" (Fallen-wizard)
 * Keywords: saruman-specific
 *
 * Card text:
 *   "Unique. Saruman specific. Playable on a non-Hobbit sage character or a
 *    Man. +1 to his direct influence. The character requires 2 points of
 *    influence to control and may only be controlled by general influence or
 *    Saruman. If at a Wizardhaven [{H}] during your organization phase, you may
 *    tap this character to place a non-unique weapon/armor/shield/helmet minor
 *    item with any character at The Forge-master's site. The recipient need not
 *    tap to receive this item, and the item may be taken from your discard pile,
 *    sideboard, or hand."
 *
 * Every rule is now implemented and exercised below:
 *  - Saruman specific — playable only while the player's revealed avatar is
 *    Saruman (generalized `wizardSpecificName` gate in the permanent-event
 *    legal-action generator).
 *  - play-target — non-Hobbit sage OR Man (existing `play-target` filter).
 *  - +1 direct influence — `stat-modifier`.
 *  - requires 2 influence to control / only general influence or Saruman —
 *    `control-restriction { cost: 2, sources: [general, fallen-wizard] }`
 *    (engine/control-cost.ts). In a single-Fallen-wizard game Saruman is the
 *    player's only Fallen-wizard avatar, so "fallen-wizard" models "or Saruman".
 *  - tap to place a w/a/s/h minor item — `grant-action` with the
 *    `place-item-on-character` apply, offered at a Wizardhaven during the
 *    organization phase; fetches from discard/sideboard/hand and places on any
 *    of the player's characters at the site, untapped.
 *  - 2 stage points while attached — `recompute-derived` sums `stage-points`
 *    from characters' items.
 *
 * Fixtures:
 *   THE_FORGE_MASTER (wh-117)  — the card under test
 *   SARUMAN_FW (wh-9)          — Saruman, the Fallen-wizard avatar (DI 12)
 *   ALATAR_FW (wh-1)           — Alatar, a different Fallen-wizard avatar
 *   ISENGARD (wh-56)           — Wizardhaven (Fallen-wizard haven)
 *   WACHO (tw-187)             — Man, scout/sage  → eligible
 *   CELEBORN (tw-136)          — Elf, warrior/sage, mind 6 → eligible
 *   EOWYN (tw-147)             — Man, warrior/scout, mind 2 → eligible
 *   BILBO (tw-131)             — Hobbit, scout/sage → NOT eligible (Hobbit)
 *   BOFUR (tw-132)             — Dwarf, warrior     → NOT eligible
 *   THE_MOUTH (le-24)          — Man, DI 4, non-avatar → DI-controller foil
 *   BLACK_HIDE_SHIELD (le-300) — non-unique minor shield → qualifying item
 *   STING (tw-333)             — unique minor weapon → excluded (unique)
 *   OLD_TREASURE (as-129)      — non-unique minor, not w/a/s/h → excluded (class)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, MORIA, RIVENDELL,
  viableActions, findCharInstanceId, getCharacter,
  attachItemToChar, recomputeDerived, dispatch, findInPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction, GameAction } from '../../index.js';
import { Alignment, CardStatus } from '../../index.js';

const THE_FORGE_MASTER = 'wh-117' as CardDefinitionId;
const SARUMAN_FW = 'wh-9' as CardDefinitionId;
const ALATAR_FW = 'wh-1' as CardDefinitionId;
const ISENGARD = 'wh-56' as CardDefinitionId;

const WACHO = 'tw-187' as CardDefinitionId;    // Man, scout/sage
const CELEBORN = 'tw-136' as CardDefinitionId; // Elf, warrior/sage, mind 6
const EOWYN = 'tw-147' as CardDefinitionId;    // Man, warrior/scout, mind 2
const BILBO = 'tw-131' as CardDefinitionId;    // Hobbit, scout/sage
const BOFUR = 'tw-132' as CardDefinitionId;    // Dwarf, warrior
const THE_MOUTH = 'le-24' as CardDefinitionId; // Man, DI 4, non-avatar

const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId; // non-unique minor shield
const STING = 'tw-333' as CardDefinitionId;             // unique minor weapon
const OLD_TREASURE = 'as-129' as CardDefinitionId;      // non-unique minor, hoard

/** Minimal opponent player block. */
const OPPONENT = {
  id: PLAYER_2,
  companies: [{ site: MORIA, characters: [GANDALF] }],
  hand: [] as CardDefinitionId[],
  siteDeck: [RIVENDELL],
};

describe('The Forge-master (wh-117)', () => {
  beforeEach(() => resetMint());

  // ─── Saruman specific — playable only by a Saruman player ──────────────────

  test('offered while the avatar is Saruman, but not while it is another Fallen-wizard', () => {
    const sarumanState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, WACHO] }],
          hand: [THE_FORGE_MASTER], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    expect(viableActions(sarumanState, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);

    // Same eligible host, but Alatar is the avatar → Saruman-specific blocks it.
    const alatarState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ALATAR_FW, WACHO] }],
          hand: [THE_FORGE_MASTER], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    expect(viableActions(alatarState, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ─── play-target — non-Hobbit sage OR Man ──────────────────────────────────

  test('offered only on non-Hobbit sages and Men', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, WACHO, CELEBORN, EOWYN, BILBO, BOFUR] }],
          hand: [THE_FORGE_MASTER], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = new Set(actions.map(a => (a.action as PlayPermanentEventAction).targetCharacterId));

    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, WACHO))).toBe(true);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN))).toBe(true);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, EOWYN))).toBe(true);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, BILBO))).toBe(false);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, BOFUR))).toBe(false);
    // The avatar (Saruman) is not an eligible host either.
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN_FW))).toBe(false);
    expect(actions).toHaveLength(3);
  });

  // ─── +1 to his direct influence ────────────────────────────────────────────

  test('grants +1 direct influence to the host character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, WACHO] }],
          hand: [], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    const baseDI = getCharacter(base, RESOURCE_PLAYER, WACHO).effectiveStats.directInfluence;
    const withCard = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, WACHO, THE_FORGE_MASTER));
    expect(getCharacter(withCard, RESOURCE_PLAYER, WACHO).effectiveStats.directInfluence).toBe(baseDI + 1);
  });

  // ─── requires 2 points of influence to control ─────────────────────────────

  test('overrides the influence-to-control cost to 2 (Celeborn mind 6 → 2)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, CELEBORN] }],
          hand: [], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    // Celeborn (mind 6) under general influence costs 6; the avatar costs 0.
    const before = base.players[0].generalInfluenceUsed;
    const withCard = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, CELEBORN, THE_FORGE_MASTER));
    // Control cost drops to 2 → GI used falls by 4.
    expect(withCard.players[0].generalInfluenceUsed).toBe(before - 4);
  });

  // ─── only general influence or Saruman may control ─────────────────────────

  test('under direct influence only Saruman may control the host, not a normal character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, THE_MOUTH, EOWYN] }],
          hand: [], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    const eowynId = findCharInstanceId(base, RESOURCE_PLAYER, EOWYN);
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN_FW);
    const mouthId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);

    // Baseline (no card): Éowyn (mind 2) can go under DI of either The Mouth
    // (DI 4) or Saruman (DI 12).
    const baseCtrls = viableActions(base, PLAYER_1, 'move-to-influence')
      .map(a => a.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === eowynId)
      .map(a => a.controlledBy);
    expect(baseCtrls).toContain(mouthId);
    expect(baseCtrls).toContain(sarumanId);

    // With the card (control cost still 2, so DI is sufficient for both), only
    // Saruman remains a legal controller — the source restriction excludes The Mouth.
    const withCard = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, EOWYN, THE_FORGE_MASTER));
    const ctrls = viableActions(withCard, PLAYER_1, 'move-to-influence')
      .map(a => a.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === eowynId)
      .map(a => a.controlledBy);
    expect(ctrls).toContain(sarumanId);
    expect(ctrls).not.toContain(mouthId);
  });

  // ─── 2 stage points while attached to a character ──────────────────────────

  test('contributes 2 stage points while attached to a character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, WACHO] }],
          hand: [], siteDeck: [RIVENDELL] },
        OPPONENT,
      ],
    });
    expect(base.players[0].stagePoints).toBe(0);
    const withCard = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, WACHO, THE_FORGE_MASTER));
    expect(withCard.players[0].stagePoints).toBe(2);
  });

  // ─── tap to place a w/a/s/h minor item from a zone onto a character ─────────

  function forgeState(opts: { discardPile?: CardDefinitionId[]; sideboard?: CardDefinitionId[]; hand?: CardDefinitionId[]; site?: CardDefinitionId }) {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: opts.site ?? ISENGARD, characters: [SARUMAN_FW, WACHO, EOWYN] }],
          hand: opts.hand ?? [], siteDeck: [RIVENDELL],
          discardPile: opts.discardPile ?? [], sideboard: opts.sideboard ?? [] },
        OPPONENT,
      ],
    });
    // The Forge-master is borne by Wacho (the host whose tap is the cost).
    return recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, WACHO, THE_FORGE_MASTER));
  }

  test('places a qualifying minor item from the discard pile onto a chosen character, untapped; bearer taps', () => {
    const state = forgeState({ discardPile: [BLACK_HIDE_SHIELD] });
    const eowynId = findCharInstanceId(state, RESOURCE_PLAYER, EOWYN);
    const shieldId = findInPile(state, RESOURCE_PLAYER, 'discardPile', BLACK_HIDE_SHIELD)!.instanceId;

    const act = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; recipientCharacterId?: unknown; targetCardId?: unknown })
      .find(a => a.actionId === 'forge-place-item' && a.recipientCharacterId === eowynId && a.targetCardId === shieldId);
    expect(act).toBeDefined();

    const after = dispatch(state, act as GameAction);

    // The shield is now on Éowyn, untapped, and gone from the discard pile.
    const eowyn = getCharacter(after, RESOURCE_PLAYER, EOWYN);
    const placed = eowyn.items.find(i => i.definitionId === BLACK_HIDE_SHIELD);
    expect(placed).toBeDefined();
    expect(placed!.status).toBe(CardStatus.Untapped);
    expect(findInPile(after, RESOURCE_PLAYER, 'discardPile', BLACK_HIDE_SHIELD)).toBeUndefined();
    // The bearer (Wacho) tapped to pay the cost.
    expect(getCharacter(after, RESOURCE_PLAYER, WACHO).status).toBe(CardStatus.Tapped);
  });

  test('offers qualifying items from the sideboard and hand too, but excludes unique and non-w/a/s/h items', () => {
    const state = forgeState({
      discardPile: [STING],            // unique → excluded
      sideboard: [BLACK_HIDE_SHIELD],  // qualifying
      hand: [OLD_TREASURE],            // minor but not w/a/s/h → excluded
    });
    const shieldId = findInPile(state, RESOURCE_PLAYER, 'sideboard', BLACK_HIDE_SHIELD)!.instanceId;

    const items = new Set(
      viableActions(state, PLAYER_1, 'activate-granted-action')
        .map(a => a.action as { actionId?: string; targetCardId?: unknown })
        .filter(a => a.actionId === 'forge-place-item')
        .map(a => a.targetCardId),
    );
    // Only the sideboard shield qualifies.
    expect(items.has(shieldId)).toBe(true);
    expect(items.size).toBe(1);
  });

  test('the ability is not offered while the bearer is not at a Wizardhaven', () => {
    const state = forgeState({ discardPile: [BLACK_HIDE_SHIELD], site: MORIA });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'forge-place-item');
    expect(offered).toBe(false);
  });
});
