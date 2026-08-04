/**
 * @module as-131.test
 *
 * Card test: Secret Book (as-131)
 * Type: minion-resource-item (minor, non-unique)
 * Alignment: ringwraith
 *
 * "Cannot be included with a starting company. Discard: to untap a
 *  Free-hold [{F}] or Border-hold [{B}] or to make Information playable
 *  at any Ruins & Lairs [{R}]. Cannot be duplicated in a given company."
 *
 * Rules & engine support:
 * | # | Rule                                              | Status      | Mechanism                                                       |
 * |---|---------------------------------------------------|-------------|-----------------------------------------------------------------|
 * | 1 | Cannot be included with a starting company        | IMPLEMENTED | play-flag `no-starting-company` + ITEM_DRAFT_RULES rule          |
 * | 2 | Discard to untap a Free-hold or Border-hold       | IMPLEMENTED | grant-action `untap-site`, when bearer at tapped free/border-hold|
 * | 3 | Discard to make Information playable @ R&L        | IMPLEMENTED | grant-action add-constraint `site-resource-unlocked` (turn)      |
 * | 4 | Cannot be duplicated in a given company           | IMPLEMENTED | duplication-limit scope `company`, max 1 (item-play path)        |
 *
 * Untap mode untaps the bearer's company's CURRENT site, gated on that
 * site being a tapped Free-hold or Border-hold (mirrors Records Unread
 * as-130 / Thrór's Map as-134). The unlock mode is unconditional — the
 * book is discarded to make the Information category playable at every
 * Ruins & Lairs for the discarding player for the rest of the turn.
 *
 * Fixture alignment: minion (ringwraith)
 *   - BURAT (as-1):   troll warrior/ranger — bearer of Secret Book
 *   - PERCHEN (as-4): orc scout/diplomat   — opponent character
 *   - LAYOS (le-19):  sage/diplomat        — sage that taps to play le-226
 *   - EAGLES_EYRIE (as-144): free-hold     — untap-mode positive site
 *   - GOBEL_MIRLOND (as-139): border-hold  — untap-mode positive site
 *   - DEAD_MARSHES (le-364): shadow-hold   — untap-mode negative (non-free/border)
 *   - DANCING_SPIRE (as-143): ruins-and-lairs (no Information) — unlock-mode site
 *   - DOL_GULDUR (le-367): minion haven    — opponent site
 *   - GLEAMING_GOLD_RING (le-311): gold-ring item (satisfies le-226 company-has-item)
 *   - SECRETS_OF_THEIR_FORGING (le-226): Information-gated event (site-has-resource information)
 *   - STRANGE_RATIONS (le-345): unrestricted minor item — item-draft control
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus, CardDefinitionId,
  dispatch, grantedActionsFor, findCharInstanceId, findHandCardId,
  expectCharItemCount, expectInDiscardPile,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import { computeLegalActions, SetupStep } from '../../index.js';
import type { GameState, SitePhaseState } from '../../index.js';

const SECRET_BOOK = 'as-131' as CardDefinitionId;
const EAGLES_EYRIE = 'as-144' as CardDefinitionId;     // free-hold
const GOBEL_MIRLOND = 'as-139' as CardDefinitionId;    // border-hold
const DEAD_MARSHES = 'le-364' as CardDefinitionId;     // shadow-hold (non-free/border)
const DANCING_SPIRE = 'as-143' as CardDefinitionId;    // ruins-and-lairs, no information
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // minion haven (opponent site)
const BURAT = 'as-1' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const LAYOS = 'le-19' as CardDefinitionId;             // sage
const GLEAMING_GOLD_RING = 'le-311' as CardDefinitionId;
const SECRETS_OF_THEIR_FORGING = 'le-226' as CardDefinitionId; // Information-gated event
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;  // unrestricted minor item

const SITE_PHASE: SitePhaseState = {
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
};

describe('Secret Book (as-131)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: Discard to untap a Free-hold or Border-hold ─────────────────

  test('untap-site is offered when bearer is at a tapped Free-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: EAGLES_EYRIE, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [EAGLES_EYRIE] },
      ],
    });
    (state.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(grantedActionsFor(state, burat, 'untap-site', PLAYER_1).length).toBe(1);
  });

  test('untap-site is offered when bearer is at a tapped Border-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBEL_MIRLOND, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [GOBEL_MIRLOND] },
      ],
    });
    (state.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(grantedActionsFor(state, burat, 'untap-site', PLAYER_1).length).toBe(1);
  });

  test('untap-site is NOT offered when the Free-hold is untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: EAGLES_EYRIE, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [EAGLES_EYRIE] },
      ],
    });

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(grantedActionsFor(state, burat, 'untap-site', PLAYER_1).length).toBe(0);
  });

  test('untap-site is NOT offered at a tapped non-Free/Border-hold site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DEAD_MARSHES, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DEAD_MARSHES] },
      ],
    });
    (state.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(grantedActionsFor(state, burat, 'untap-site', PLAYER_1).length).toBe(0);
  });

  test('untap-site is offered during the site phase (play-resources step), not just organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: EAGLES_EYRIE, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [EAGLES_EYRIE] },
      ],
    });
    (base.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;
    const state: GameState = { ...base, phaseState: SITE_PHASE };

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(grantedActionsFor(state, burat, 'untap-site', PLAYER_1).length).toBe(1);
  });

  test('activating untap-site untaps the Border-hold and discards the item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBEL_MIRLOND, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [GOBEL_MIRLOND] },
      ],
    });
    (state.players[RESOURCE_PLAYER].companies[0].currentSite as { status: CardStatus }).status = CardStatus.Tapped;

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const action = grantedActionsFor(state, burat, 'untap-site', PLAYER_1)[0];
    expect(action).toBeDefined();

    const next = dispatch(state, action);
    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, BURAT, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, SECRET_BOOK);
  });

  // ── Rule 3: Discard to make Information playable at any Ruins & Lairs ────

  test('activating mode B adds a site-resource-unlocked constraint and discards the item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });

    const burat = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const action = grantedActionsFor(state, burat, 'unlock-information-at-ruins-and-lairs', PLAYER_1)[0];
    expect(action).toBeDefined();

    const next = dispatch(state, action);

    const unlock = next.activeConstraints.find(c => c.kind.type === 'site-resource-unlocked');
    expect(unlock).toBeDefined();
    if (unlock && unlock.kind.type === 'site-resource-unlocked') {
      expect(unlock.kind.siteType).toBe('ruins-and-lairs');
      expect(unlock.kind.subtype).toBe('information');
      expect(unlock.scope.kind).toBe('turn');
      expect(unlock.target.kind).toBe('player');
      if (unlock.target.kind === 'player') expect(unlock.target.playerId).toBe(PLAYER_1);
    }
    expectCharItemCount(next, RESOURCE_PLAYER, BURAT, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, SECRET_BOOK);
  });

  test('Information card is unplayable at a Ruins & Lairs lacking it, then playable once unlocked', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: LAYOS, items: [GLEAMING_GOLD_RING] }] }], hand: [SECRETS_OF_THEIR_FORGING], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PHASE };
    const secretsId = findHandCardId(state, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);

    // Dancing Spire is a Ruins & Lairs but does not list Information — not playable.
    const before = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && (ea.action as { cardInstanceId?: string }).cardInstanceId === secretsId);
    expect(before.length).toBe(0);

    // Mode B unlocks Information at all Ruins & Lairs for this player this turn.
    const unlocked = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: SECRET_BOOK,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'site-resource-unlocked', siteType: 'ruins-and-lairs', subtype: 'information' },
    });
    const after = computeLegalActions(unlocked, PLAYER_1)
      .filter(ea => ea.viable && (ea.action as { cardInstanceId?: string }).cardInstanceId === secretsId);
    expect(after.length).toBeGreaterThan(0);
  });

  test('unlock is scoped to the discarding player — does not unlock for the opponent', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: LAYOS, items: [GLEAMING_GOLD_RING] }] }], hand: [SECRETS_OF_THEIR_FORGING], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    // Constraint owned by PLAYER_2; PLAYER_1's Information card stays blocked.
    const otherUnlock = addConstraint({ ...base, phaseState: SITE_PHASE }, {
      source: mint(),
      sourceDefinitionId: SECRET_BOOK,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_2 },
      kind: { type: 'site-resource-unlocked', siteType: 'ruins-and-lairs', subtype: 'information' },
    });
    const secretsId = findHandCardId(otherUnlock, RESOURCE_PLAYER, SECRETS_OF_THEIR_FORGING);
    const actions = computeLegalActions(otherUnlock, PLAYER_1)
      .filter(ea => ea.viable && (ea.action as { cardInstanceId?: string }).cardInstanceId === secretsId);
    expect(actions.length).toBe(0);
  });

  // ── Rule 4: Cannot be duplicated in a given company ─────────────────────

  test('a second copy is not playable when one is already in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: BURAT, items: [SECRET_BOOK] }] }], hand: [SECRET_BOOK], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PHASE };
    const handCopy = findHandCardId(state, RESOURCE_PLAYER, SECRET_BOOK);
    const playable = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handCopy);
    expect(playable.length).toBe(0);
  });

  test('a single copy is playable when none is yet in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [BURAT] }], hand: [SECRET_BOOK], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const state: GameState = { ...base, phaseState: SITE_PHASE };
    const handCopy = findHandCardId(state, RESOURCE_PLAYER, SECRET_BOOK);
    const playable = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handCopy);
    expect(playable.length).toBeGreaterThan(0);
  });

  // ── Rule 1: Cannot be included with a starting company ──────────────────

  test('Secret Book is rejected as a starting item; an unrestricted minor item is accepted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BURAT] }], hand: [], siteDeck: [DANCING_SPIRE] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    });
    const bookInst = { instanceId: mint(), definitionId: SECRET_BOOK };
    const rationsInst = { instanceId: mint(), definitionId: STRANGE_RATIONS };
    const state: GameState = {
      ...base,
      phaseState: {
        phase: Phase.Setup,
        setupStep: {
          step: SetupStep.ItemDraft,
          itemDraftState: [
            { unassignedItems: [bookInst, rationsInst], done: false },
            { unassignedItems: [], done: true },
          ],
          remainingPool: [[], []],
        },
      },
    } as GameState;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.action.type === 'assign-starting-item');

    const bookActions = actions.filter(ea => (ea.action as { itemDefId?: string }).itemDefId === SECRET_BOOK);
    expect(bookActions.length).toBeGreaterThan(0);
    expect(bookActions.every(ea => !ea.viable)).toBe(true);
    expect(bookActions[0].reason).toMatch(/starting company/i);

    const rationsActions = actions.filter(ea => ea.viable && (ea.action as { itemDefId?: string }).itemDefId === STRANGE_RATIONS);
    expect(rationsActions.length).toBeGreaterThan(0);
  });
});
