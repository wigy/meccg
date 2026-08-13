/**
 * @module td-165.test
 *
 * Card test: Waybread (td-165)
 * Type: hero-resource-item (special), alignment wizard, non-unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * "Only playable at Lórien. Discard to untap bearer or bearer and one other
 *  character in his company. Alternatively, discard during organization
 *  phase to allow its bearer's company to play an additional region card."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                              |
 * |---|----------------------------------------------------|--------------------------------------------------------|
 * | 1 | Only playable at Lórien                            | `item-play-site` `sites: ["Lórien"]`                    |
 * | 2 | Discard to untap bearer                            | `grant-action untap-bearer`, `cost: discard self`       |
 * | 3 | Discard to untap bearer and one other company-mate | `grant-action untap-bearer-and-company-character`,      |
 * |   |                                                    | `targets: { scope: company-characters, excludeBearer }` |
 * | 4 | Discard during organization for +1 region card     | `grant-action extra-region-movement` (Cram td-105       |
 * |   |                                                    | precedent, shared verbatim)                             |
 *
 * All three discard modes share the same one-shot `discard: "self"` cost on
 * the same card instance, so activating any one of them removes Waybread and
 * naturally forecloses the others — the "or" in the printed text needs no
 * `oncePerTurn` lock or same-action-name mode discrimination.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viableActions, dispatch,
  CardStatus, Phase,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const WAYBREAD = 'td-165' as CardDefinitionId;

describe('Waybread (td-165)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: only playable at Lórien ────────────────────────────────────────

  test('playable at Lórien during the site phase', () => {
    const state = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [WAYBREAD] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('NOT playable at Moria', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [WAYBREAD] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Rule 2: discard to untap bearer only ───────────────────────────────────

  test('untap-bearer is offered when the bearer is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WAYBREAD], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-bearer');
    expect(grants).toHaveLength(1);
  });

  test('untap-bearer is NOT offered when the bearer is already untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WAYBREAD] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-bearer');
    expect(grants).toHaveLength(0);
  });

  test('activating untap-bearer discards Waybread and untaps only the bearer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, items: [WAYBREAD], status: CardStatus.Tapped },
            { defId: GIMLI, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'untap-bearer')!;
    const after = dispatch(state, grant);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    // Gimli, who did not pay for or receive this activation, stays tapped.
    expectCharStatus(after, RESOURCE_PLAYER, GIMLI, CardStatus.Tapped);
    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WAYBREAD);
  });

  // ─── Rule 3: discard to untap bearer AND one other company-mate ────────────

  function buildCompanyState(companionSpec: { defId: CardDefinitionId; status?: CardStatus }, bearerStatus?: CardStatus) {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [
            { defId: ARAGORN, items: [WAYBREAD], status: bearerStatus },
            companionSpec,
          ] }],
          hand: [], siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('untap-bearer-and-company-character is offered per tapped company-mate, carrying the target', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped }, CardStatus.Tapped);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-bearer-and-company-character');
    expect(grants).toHaveLength(1);
    expect(grants[0].targetCardId).toBe(gimliId);
  });

  test('untap-bearer-and-company-character is NOT offered when the company-mate is already untapped', () => {
    const state = buildCompanyState({ defId: GIMLI }, CardStatus.Tapped);

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-bearer-and-company-character');
    expect(grants).toHaveLength(0);
  });

  test('untap-bearer-and-company-character is NOT offered as its own bearer (excludeBearer)', () => {
    // Solo company: no candidate other than the bearer, so the two-character
    // mode must not fall back to targeting the bearer itself.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WAYBREAD], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-bearer-and-company-character');
    expect(grants).toHaveLength(0);
  });

  test('activating untap-bearer-and-company-character discards Waybread and untaps both characters', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped }, CardStatus.Tapped);

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'untap-bearer-and-company-character')!;
    const after = dispatch(state, grant);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, GIMLI, CardStatus.Untapped);
    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WAYBREAD);
  });

  test('untap-bearer-and-company-character is still offered when the bearer is already untapped (untapping him is idempotent)', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped }, CardStatus.Untapped);

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'untap-bearer-and-company-character')!;
    const after = dispatch(state, grant);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, GIMLI, CardStatus.Untapped);
    expectInDiscardPile(after, RESOURCE_PLAYER, WAYBREAD);
  });

  // ─── Rule 4: discard during organization for +1 region card ────────────────

  test('extra-region-movement is offered during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WAYBREAD] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'extra-region-movement');
    expect(grants).toHaveLength(1);
  });

  test('activating extra-region-movement discards Waybread and sets extraRegionDistance', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WAYBREAD] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'extra-region-movement')!;
    const after = dispatch(state, grant);

    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WAYBREAD);
    expect(after.players[0].companies[0].extraRegionDistance).toBe(1);
  });

  // ─── The three modes are mutually exclusive (one card, one discard) ───────

  test('all three discard modes are simultaneously offered before any is used', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped }, CardStatus.Tapped);

    const actionIds = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => (ea.action as ActivateGrantedAction).actionId);

    expect(actionIds).toContain('untap-bearer');
    expect(actionIds).toContain('untap-bearer-and-company-character');
    expect(actionIds).toContain('extra-region-movement');
  });

  test('using untap-bearer-and-company-character consumes Waybread, so the other two modes vanish', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped }, CardStatus.Tapped);

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'untap-bearer-and-company-character')!;
    const after = dispatch(state, grant);

    const actionIds = viableActions(after, PLAYER_1, 'activate-granted-action')
      .map(ea => (ea.action as ActivateGrantedAction).actionId);
    expect(actionIds).not.toContain('untap-bearer');
    expect(actionIds).not.toContain('untap-bearer-and-company-character');
    expect(actionIds).not.toContain('extra-region-movement');
  });
});
