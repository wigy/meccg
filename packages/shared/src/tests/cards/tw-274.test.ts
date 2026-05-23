/**
 * @module tw-274.test
 *
 * Card test: Magic Ring of Stealth (tw-274)
 * Type: hero-resource-item (special)
 *
 * Printed text:
 *   "Magic Ring. Playable only with a gold ring and after a test indicates a
 *    Magic Ring. Gives the bearer scout skill. If the bearer is already a scout,
 *    he may tap the Magic Ring of Stealth to cancel a strike directed against him.
 *    Cannot be duplicated on a given character."
 *
 * Rule coverage:
 *
 * | # | Rule                                                      | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Gives the bearer scout skill                              | effect |
 * | 2 | Natural scout may tap ring to cancel a strike             | effect |
 * | 3 | Non-natural scout cannot use cancel-strike                | effect |
 * | 4 | Cannot be duplicated on a given character                 | data   |
 *
 * Note: "Playable only with a gold ring and after a test indicates a Magic Ring"
 * is enforced by the gold-ring-test system. The replacement-ring play step of
 * the gold-ring-test (Rule 9.21) is not yet implemented, so Rules 1-3 are
 * exercised by pre-attaching the ring in test state rather than through the
 * ring-play flow. The duplication limit (Rule 4) requires the ring play path
 * and is not exercisable until the replacement step is implemented.
 *
 * "Gives scout skill" (Rule 1) is verified by showing that a non-scout
 * character bearing the ring satisfies the Stealth card's DSL target filter
 * (`target.skills.$includes.scout`). Without the ring the same character
 * fails the filter. The cancel-strike condition reads natural skills only
 * (charDef.skills), correctly implementing "if the bearer is ALREADY a scout."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  FRODO, LEGOLAS,
  ORC_LIEUTENANT,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  STEALTH,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId, viableActions, getCharacter,
  handCardId, companyIdAt, dispatch, resolveChain,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CancelStrikeAction } from '../../index.js';

const MAGIC_RING_OF_STEALTH = 'tw-274' as CardDefinitionId;

describe('Magic Ring of Stealth (tw-274)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Gives the bearer scout skill ────────────────────────────────

  test('non-scout bearer counts as scout for Stealth targeting', () => {
    // Legolas is naturally a warrior+diplomat, not a scout.
    // With the ring attached he should satisfy Stealth's scout filter.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('non-scout without ring fails Stealth scout filter', () => {
    // Without the ring Legolas has no scout skill → Stealth not playable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.filter(a => a.viable)).toHaveLength(0);
  });

  // ── Rule 2: Natural scout may tap ring to cancel a strike ───────────────

  test('natural scout bearer can tap ring to cancel a strike against themselves', () => {
    // Frodo is a natural scout. With the ring attached he should be able to
    // tap it to cancel a strike.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: FRODO, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const ltId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();

    const frodoId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FRODO);
    const ringId = getCharacter(afterChain, RESOURCE_PLAYER, FRODO).items[0].instanceId;

    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: frodoId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions).toHaveLength(1);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).cancellerInstanceId).toBe(ringId);
    expect(actionAs<CancelStrikeAction>(cancelStrikeActions[0].action).targetCharacterId).toBe(frodoId);

    const r3 = dispatch(r2, cancelStrikeActions[0].action);

    // Ring is tapped; Frodo is NOT tapped (cancel-strike leaves him untapped)
    const frodoAfter = r3.players[0].characters[frodoId as string];
    const ringAfter = frodoAfter.items.find(i => i.instanceId === ringId)!;
    expect(ringAfter.status).toBe(CardStatus.Tapped);
    expect(frodoAfter.status).toBe(CardStatus.Untapped);
  });

  // ── Rule 3: Non-natural scout cannot use cancel-strike ──────────────────

  test('non-scout bearer cannot tap ring to cancel a strike', () => {
    // Legolas is NOT a natural scout. Even though the ring grants scout skill,
    // the cancel-strike condition checks "already a scout" (natural skill),
    // so the ring's cancel-strike is not available to Legolas.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [FRODO] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const ltId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();

    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const r2 = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });
    expect(r2.combat!.phase).toBe('resolve-strike');

    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelStrikeActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike',
    );
    expect(cancelStrikeActions).toHaveLength(0);
  });
});
