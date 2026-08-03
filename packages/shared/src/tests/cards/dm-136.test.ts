/**
 * @module dm-136.test
 *
 * Card test: Herb-lore (dm-136)
 * Type: hero-resource-event (permanent), played on a character (Radagast)
 * Effects:
 *   1. play-target character filter target.name "Radagast" — only Radagast may bear it
 *   2. play-window movement-hazard — only playable during his M/H phase
 *   3. play-condition site-path (sitePath.wildernessCount >= 1) — requires the
 *      currently-moving company (Radagast's own) to have at least one
 *      Wilderness [{w}] in its resolved site path
 *   4. on-event self-enters-play → set-character-status tapped, when
 *      target.status untapped — "If untapped, tap Radagast afterwards."
 *   5. grant-action (organization phase, cost tap bearer + discard self) →
 *      set-character-status target company status untapped — heals every
 *      wounded company member to untapped and untaps every tapped one
 *      (confirmed by the official ruling to include Radagast himself, even
 *      though he just tapped to pay the activation cost)
 *
 * "Playable on Radagast while moving during his movement/hazard phase if
 *  there is at least one Wilderness [{w}] in his site path. If untapped, tap
 *  Radagast afterwards. During any organization phase, Radagast can tap and
 *  discard this card to heal all characters in his company from wounded to
 *  untapped and to untap all tapped characters."
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, dispatch,
  playPermanentEventAndResolve,
  makeMHState, makeSitePhase,
  findCharInstanceId, findHandCardId,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  CardStatus,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction, ActivateGrantedAction } from '../../index.js';

const HERB_LORE = 'dm-136' as CardDefinitionId;
const RADAGAST = 'tw-178' as CardDefinitionId;

describe('Herb-lore (dm-136)', () => {
  beforeEach(() => resetMint());

  // ── Phase restriction (play-window movement-hazard) ─────────────────────

  test('not playable during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not playable during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── play-target: only Radagast qualifies ─────────────────────────────────

  test('not playable when Radagast is not in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('only Radagast is offered as a target, not other company members', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const a = actions[0].action as PlayPermanentEventAction;
    expect(a.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST));
  });

  // ── play-condition site-path: needs a Wilderness in the resolved path ────

  test('not offered when there is no Wilderness in the site path', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Shadow, RegionType.Border],
      }),
    };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('playable when the site path contains at least one Wilderness', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
      }),
    };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  test('not offered when the active company is not moving (stationary)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // destinationSiteName: null / siteRevealed: false means the active company is not moving
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: null }) };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not offered for Radagast when his company is not the M/H phase\'s currently-active one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [RADAGAST] },   // company 0 — stationary (Radagast here)
            { site: LORIEN, characters: [ARAGORN] },    // company 1 — the active/moving one
          ],
          hand: [HERB_LORE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 1, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── on-event self-enters-play: tap Radagast if he was untapped ───────────

  test('playing the card taps Radagast when he was untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };
    expectCharStatus(state, RESOURCE_PLAYER, RADAGAST, CardStatus.Untapped);

    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, HERB_LORE), radagastId);

    expectCharStatus(after, RESOURCE_PLAYER, RADAGAST, CardStatus.Tapped);
    // The permanent event attaches to Radagast (as an item), not the discard pile.
    expectCharItemCount(after, RESOURCE_PLAYER, RADAGAST, 1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('playing the card on an already-tapped Radagast leaves him tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: RADAGAST, status: CardStatus.Tapped }] }], hand: [HERB_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true,
        resolvedSitePath: [RegionType.Wilderness],
      }),
    };

    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, HERB_LORE), radagastId);

    expectCharStatus(after, RESOURCE_PLAYER, RADAGAST, CardStatus.Tapped);
    expectCharItemCount(after, RESOURCE_PLAYER, RADAGAST, 1);
  });

  // ── grant-action (organization phase): heal + untap the whole company ────

  test('herb-lore-heal-and-untap-company is available during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: RADAGAST, items: [HERB_LORE] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'herb-lore-heal-and-untap-company');
    expect(actions).toHaveLength(1);
  });

  test('not available when Radagast (the bearer) is already tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: RADAGAST, items: [HERB_LORE], status: CardStatus.Tapped },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'herb-lore-heal-and-untap-company');
    expect(actions).toHaveLength(0);
  });

  test('not available outside the organization phase (M/H)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: RADAGAST, items: [HERB_LORE] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'herb-lore-heal-and-untap-company');
    expect(actions).toHaveLength(0);
  });

  test('not available outside the organization phase (site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: RADAGAST, items: [HERB_LORE] },
            { defId: ARAGORN, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'herb-lore-heal-and-untap-company');
    expect(actions).toHaveLength(0);
  });

  test('activating heals the wounded, untaps the tapped, discards the card, and (per official ruling) leaves Radagast himself untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: RADAGAST, items: [HERB_LORE] },
            { defId: ARAGORN, status: CardStatus.Inverted },
            { defId: LEGOLAS, status: CardStatus.Tapped },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'herb-lore-heal-and-untap-company')!.action;
    const after = dispatch(state, action);

    // Aragorn: wounded (Inverted) → untapped.
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    // Legolas: tapped → untapped.
    expectCharStatus(after, RESOURCE_PLAYER, LEGOLAS, CardStatus.Untapped);
    // Radagast tapped to pay the cost, but the company-wide heal/untap catches
    // him too — the official ruling confirms he ends up untapped as well.
    expectCharStatus(after, RESOURCE_PLAYER, RADAGAST, CardStatus.Untapped);
    // The card is discarded from Radagast's items.
    expectCharItemCount(after, RESOURCE_PLAYER, RADAGAST, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, HERB_LORE);
  });
});
