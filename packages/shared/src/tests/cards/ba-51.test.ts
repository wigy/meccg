/**
 * @module ba-51.test
 *
 * Card test: Caverns Unchoked (ba-51)
 * Type: minion-resource-event (permanent) · alignment: ringwraith · Balrog-specific
 * Marshalling points: 0
 *
 * Card text:
 *   "Balrog specific. Playable on an Under-deeps site during the organization
 *    phase. This site is never discarded or returned to its location deck. Each
 *    other site (of yours) in the same region as its surface site is considered
 *    adjacent to this Under-deeps site. This only applies if the other site is
 *    normally a Shadow-hold [{S}], Ruins & Lairs [{R}], or Border-hold [{B}]."
 *
 * Modelled with two effects:
 *   - `play-target` target `site`, filtered to the `under-deeps` keyword — the
 *     card binds to the Under-deeps site it is played on (`attachedToSite`); the
 *     org-phase play path (`legal-actions/organization-events.ts`) allows this
 *     Balrog resource permanent-event on a company's current Under-deeps site.
 *   - `surface-region-adjacency` (siteTypes shadow-hold / ruins-and-lairs /
 *     border-hold) — while in play it (1) is exempt from the site-attached
 *     orphan sweep and forces the bound site to return to the location deck
 *     rather than the discard pile when a company leaves it ("never discarded or
 *     returned to its location deck"), and (2) makes each of the owner's other
 *     same-region S/R/B sites Under-deeps-adjacent to it at a required roll of 0
 *     (`cavernsUnchokedAdjacencyRoll`, consulted by `isUnderDeepsAdjacent` and
 *     `getUnderDeepsRequiredRoll` via the moving player).
 *
 * The Under-deeps site's surface site always shares its region, so the region is
 * taken from the Under-deeps site's own `region` field. "Balrog specific" is a
 * deck-construction keyword (no play-time gate), matching the ba-45 / ba-46
 * precedent.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Playable on an Under-deeps site during the organization phase | OK     |
 * | 2 | Not playable off an Under-deeps site                          | OK     |
 * | 3 | Bound site never discarded/returned (permanent + returns deck)| OK     |
 * | 4 | Same-region S/R/B sites become adjacent (roll 0)              | OK     |
 * | 5 | Only S/R/B, only same region, only your sites                 | OK     |
 *
 * Playable: YES
 * Certified: 2026-07-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  resetMint, pool, buildTestState, makeMHState, dispatch,
  playPermanentEventAndResolve,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus, computeLegalActions } from '../../index.js';
import { MovementType } from '../../types/common.js';
import {
  isUnderDeepsAdjacent, cavernsUnchokedAdjacencyRoll,
} from '../../engine/legal-actions/organization-companies.js';
import { getUnderDeepsRequiredRoll } from '../../engine/mh-steps.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, SiteCard, MovementHazardPhaseState,
} from '../../index.js';

const CAVERNS_UNCHOKED = 'ba-51' as CardDefinitionId;

// Sites
const THE_UNDER_VAULTS = 'ba-103' as CardDefinitionId; // Under-deeps, Ruins & Lairs, region Angmar (surface Mount Gram)
const ZARAK_DUM = 'le-417' as CardDefinitionId;         // Ruins & Lairs, Angmar — NOT in ba-103's static adjacency
const MOUNT_GRAM = 'le-394' as CardDefinitionId;        // Shadow-hold, Angmar — the printed surface site (static roll 0)
const CARN_DUM = 'ba-85' as CardDefinitionId;           // Dark-hold, Angmar — same region but NOT S/R/B
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // Shadow-hold, High Pass — S/R/B but different region

// Balrog-specific minion character
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;

/** A Caverns Unchoked card-in-play bound to a given Under-deeps site. */
function cavernsInPlay(siteDefId: CardDefinitionId): CardInPlay {
  return {
    instanceId: `ba51-${siteDefId as string}` as CardInstanceId,
    definitionId: CAVERNS_UNCHOKED,
    status: CardStatus.Untapped,
    attachedToSite: siteDefId,
  };
}

const UNDER_VAULTS_DEF = pool[THE_UNDER_VAULTS as string] as SiteCard;
const ZARAK_DUM_DEF = pool[ZARAK_DUM as string] as SiteCard;
const CARN_DUM_DEF = pool[CARN_DUM as string] as SiteCard;
const GOBLIN_GATE_DEF = pool[GOBLIN_GATE as string] as SiteCard;

describe('Caverns Unchoked (ba-51)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: playability (organization phase, on an Under-deeps site) ──────

  test('offered as a play-permanent-event on the Under-deeps site during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [CAVERNS_UNCHOKED], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CAVERNS_UNCHOKED)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(THE_UNDER_VAULTS);
  });

  test('NOT offered when the company is at a non-Under-deeps site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MOUNT_GRAM, characters: [CROOK_LEGGED_ORC] }], hand: [CAVERNS_UNCHOKED], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: GOBLIN_GATE, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CAVERNS_UNCHOKED)!.instanceId;
    const viable = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(viable).toHaveLength(0);
  });

  test('playing it binds the card to the Under-deeps site (attachedToSite)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [CAVERNS_UNCHOKED], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CAVERNS_UNCHOKED)!.instanceId;
    const after = playPermanentEventAndResolve(state, PLAYER_1, id, undefined, { targetSiteDefinitionId: THE_UNDER_VAULTS });
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === CAVERNS_UNCHOKED);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(THE_UNDER_VAULTS);
  });

  // ── Rule 4 & 5: surface-region adjacency ─────────────────────────────────────

  test('a same-region Ruins & Lairs site (Zarak Dûm) becomes adjacent to the Under-deeps site (roll 0)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [ZARAK_DUM],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    // Baseline: not statically adjacent (ba-103 lists only Mount Gram / UD sites).
    expect(isUnderDeepsAdjacent(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF)).toBe(false);
    // With Caverns Unchoked bound and Zarak Dûm owned: adjacent at roll 0.
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBe(0);
    expect(isUnderDeepsAdjacent(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBe(0);
  });

  test('adjacency does not apply to a same-region non-S/R/B site (dark-hold Carn Dûm)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [CARN_DUM],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, CARN_DUM_DEF, PLAYER_1)).toBeUndefined();
    expect(isUnderDeepsAdjacent(state, UNDER_VAULTS_DEF, CARN_DUM_DEF, PLAYER_1)).toBe(false);
  });

  test('adjacency does not apply to an S/R/B site in a different region (Goblin-gate, High Pass)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [GOBLIN_GATE],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, GOBLIN_GATE_DEF, PLAYER_1)).toBeUndefined();
    expect(isUnderDeepsAdjacent(state, UNDER_VAULTS_DEF, GOBLIN_GATE_DEF, PLAYER_1)).toBe(false);
  });

  test('adjacency applies only to the card owner ("of yours") and only to sites they own', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [ZARAK_DUM],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    // "of yours": the opponent gains no adjacency from PLAYER_1's card.
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_2)).toBeUndefined();
    // A player-agnostic caller (e.g. hazard-creature keying) sees no dynamic adjacency.
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, undefined)).toBeUndefined();

    // A same-region S/R/B site the player does NOT own is not adjacent.
    const notOwned = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [], // Zarak Dûm not in the Balrog's site set
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [ZARAK_DUM] },
      ],
    });
    expect(cavernsUnchokedAdjacencyRoll(notOwned, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBeUndefined();
  });

  test('without Caverns Unchoked in play there is no dynamic adjacency', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    expect(cavernsUnchokedAdjacencyRoll(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBeUndefined();
    expect(isUnderDeepsAdjacent(state, UNDER_VAULTS_DEF, ZARAK_DUM_DEF, PLAYER_1)).toBe(false);
  });

  // ── Rule 4: adjacency drives movement (org-phase plan + M/H declare-path) ─────

  test('organization-phase plan-movement offers the newly-adjacent site only with Caverns Unchoked in play', () => {
    const withCard = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [ZARAK_DUM, CARN_DUM, GOBLIN_GATE],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const destDefIds = (s: GameState) => computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'plan-movement')
      .map(a => {
        const instId = (a.action as { destinationSite: CardInstanceId }).destinationSite;
        return s.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === instId)?.definitionId;
      });

    const withDest = destDefIds(withCard);
    expect(withDest).toContain(ZARAK_DUM);   // same-region Ruins & Lairs → adjacent
    expect(withDest).not.toContain(CARN_DUM);   // same region but dark-hold
    expect(withDest).not.toContain(GOBLIN_GATE); // S/R/B but different region

    const withoutCard: GameState = {
      ...withCard,
      players: [{ ...withCard.players[RESOURCE_PLAYER], cardsInPlay: [] }, withCard.players[1]] as GameState['players'],
    };
    expect(destDefIds(withoutCard)).not.toContain(ZARAK_DUM);
  });

  test('movement/hazard reveal offers Under-deeps declare-path to the newly-adjacent site at roll 0', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC], destinationSite: ZARAK_DUM }],
          hand: [], siteDeck: [],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const declares = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'declare-path'
        && (a.action as { movementType?: MovementType }).movementType === MovementType.UnderDeeps);
    expect(declares).toHaveLength(1);

    // Roll 0 (surface-region adjacency): auto-advances straight to draw-cards.
    const result = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
    const mhState = result.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('draw-cards');
    expect(mhState.movementType).toBe(MovementType.UnderDeeps);
  });

  // ── Rule 3: the bound site is never discarded or returned to its deck ─────────

  test('the permanent event survives the site-attached orphan sweep while its bound site is unoccupied', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          // No company at The Under-vaults — it is unoccupied.
          companies: [{ site: MOUNT_GRAM, characters: [CROOK_LEGGED_ORC] }],
          hand: [], siteDeck: [THE_UNDER_VAULTS],
          cardsInPlay: [cavernsInPlay(THE_UNDER_VAULTS)],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: GOBLIN_GATE, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const swept = discardOrphanedSiteAttachedEvents(state);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === CAVERNS_UNCHOKED)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === CAVERNS_UNCHOKED)).toBe(false);
  });

  test('leaving a tapped bound Under-deeps site returns it to the location deck (not discarded)', () => {
    // Company at a TAPPED The Under-vaults (Ruins & Lairs, non-haven) moving away.
    // Without Caverns a tapped non-haven origin would be discarded (rule 5.26);
    // Caverns Unchoked forces it back to the location deck instead.
    const buildLeaving = (withCard: boolean): GameState => {
      const built = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1, alignment: Alignment.Balrog,
            companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }],
            hand: [], siteDeck: [ZARAK_DUM],
            cardsInPlay: withCard ? [cavernsInPlay(THE_UNDER_VAULTS)] : [],
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MOUNT_GRAM, characters: [] }], hand: [], siteDeck: [] },
        ],
      });
      const company = built.players[0].companies[0];
      const destInst = built.players[0].siteDeck.find(c => c.definitionId === ZARAK_DUM)!;
      return {
        ...built,
        phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
        players: [
          {
            ...built.players[0],
            companies: [{
              ...company,
              currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
              siteCardOwned: true,
              destinationSite: { instanceId: destInst.instanceId, definitionId: ZARAK_DUM, status: CardStatus.Untapped },
              siteOfOrigin: company.currentSite!.instanceId,
            }],
          },
          built.players[1],
        ] as GameState['players'],
      };
    };

    // Control: without the card, the tapped origin is discarded.
    const withoutCard = buildLeaving(false);
    const originIdNoCard = withoutCard.players[0].companies[0].currentSite!.instanceId;
    let after = dispatch(withoutCard, { type: 'pass', player: PLAYER_1 });
    after = dispatch(after, { type: 'pass', player: PLAYER_2 });
    expect(after.players[0].siteDiscardPile.some(c => c.instanceId === originIdNoCard)).toBe(true);
    expect(after.players[0].siteDeck.some(c => c.instanceId === originIdNoCard)).toBe(false);

    // With the card: the tapped origin is returned to the location deck instead,
    // and the permanent event persists in play.
    const withCard = buildLeaving(true);
    const originId = withCard.players[0].companies[0].currentSite!.instanceId;
    let after2 = dispatch(withCard, { type: 'pass', player: PLAYER_1 });
    after2 = dispatch(after2, { type: 'pass', player: PLAYER_2 });
    expect(after2.players[0].siteDiscardPile.some(c => c.instanceId === originId)).toBe(false);
    expect(after2.players[0].siteDeck.some(c => c.instanceId === originId)).toBe(true);
    expect(after2.players[0].cardsInPlay.some(c => c.definitionId === CAVERNS_UNCHOKED)).toBe(true);
  });
});
