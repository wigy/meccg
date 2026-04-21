/**
 * @module le-415.test
 *
 * Card test: The Worthy Hills (le-415)
 * Type: minion-site (ruins-and-lairs) in Cardolan
 * Effects: 1 (site-rule: never-taps)
 *
 * Text:
 *   Playable: Information.
 *   Automatic-attacks: Men — each character faces 1 strike with 9 prowess
 *     (detainment against covert company).
 *   Special: This site never taps.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness] — matches card {s}{w}{w}  |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)      |
 * | 4 | region            | OK     | "Cardolan" — valid region in card pool                     |
 * | 5 | playableResources | OK     | [information] — matches card text                          |
 * | 6 | automaticAttacks  | OK     | Men, prowess 9, per-character strikes, detainment-vs-covert|
 * | 7 | resourceDraws     | OK     | 1                                                          |
 * | 8 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                                   |
 * |---|-------------------------------|-------------|---------------------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, play-resources           |
 * | 2 | Haven path movement           | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Carn Dûm        |
 * | 3 | Region movement               | IMPLEMENTED | Cardolan is reachable from Angmar (Carn Dûm)            |
 * | 4 | Card draws                    | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase    |
 * | 5 | Playable: Information (data)  | IMPLEMENTED | playableResources gates resource subtypes at this site  |
 * | 6 | Never-taps special rule       | IMPLEMENTED | site-rule: never-taps — reducer skips site-tap in both  |
 * |   |                               |             | play-hero-resource and influence-attempt paths          |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2,
  pool, LORIEN,
  RESOURCE_PLAYER,
  charIdAt, handCardId, companyIdAt,
  dispatch, viableActions,
} from '../test-helpers.js';
import {
  Alignment, Phase, CardStatus,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type {
  CardDefinitionId, SiteCard, SitePhaseState, GameState,
} from '../../index.js';

const THE_WORTHY_HILLS = 'le-415' as CardDefinitionId;
const BANDIT_LAIR_LE = 'le-351' as CardDefinitionId;   // ruins-and-lairs, allows minor; no never-taps
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Minion fixtures — minor-item-playable scenario requires a minion character
// that can carry a minion item. Declared locally per the card-ids policy.
const GORBAG = 'le-11' as CardDefinitionId;                 // prowess 6, warrior/scout
const LAGDUF = 'le-18' as CardDefinitionId;
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;     // minor minion item
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;

const basePlayResourcesPhaseState = (
  state: GameState,
): SitePhaseState => ({
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
});

function setupPlayResourcesAt(site: CardDefinitionId): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [GORBAG] }],
        hand: [SAW_TOOTHED_BLADE],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  return { ...base, phaseState: basePlayResourcesPhaseState(base) };
}

describe('The Worthy Hills (le-415)', () => {
  beforeEach(() => resetMint());

  // ─── Subtype gate: Playable: Information ────────────────────────────────────
  // The site's playableResources list is `[information]`. The legal-action
  // layer consults playableResources when proposing item plays, so a minor
  // minion item in hand at The Worthy Hills must be marked not-playable —
  // proving the subtype gate really is live for this site.

  test('minor minion item is NOT offered as a viable play at The Worthy Hills', () => {
    const state = setupPlayResourcesAt(THE_WORTHY_HILLS);
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  test('same minor minion item IS offered as a viable play at Bandit Lair (allows minor)', () => {
    // Regression guard: if the item is not playable anywhere in the test's
    // minion fixture, the above "not playable" check is meaningless. Bandit
    // Lair (le-351) lists minor items, so the same item/character pair must
    // produce a viable play there.
    const state = setupPlayResourcesAt(BANDIT_LAIR_LE);
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Never-taps: item play at the site ─────────────────────────────────────
  // The site's playableResources only lists "information", so the legal-action
  // layer never offers an item play here. The never-taps mechanic, however,
  // lives in the reducer's site-tap step — whenever a resource would otherwise
  // tap the site, the rule must short-circuit the tap. These tests drive the
  // reducer directly with a `play-hero-resource` action (skipping the legal
  // gate) to observe the resulting site status.

  test('never-taps: playing a resource does NOT tap The Worthy Hills', () => {
    const state = setupPlayResourcesAt(THE_WORTHY_HILLS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const charId = charIdAt(state, RESOURCE_PLAYER);
    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);

    const beforeStatus = state.players[RESOURCE_PLAYER].companies[0].currentSite!.status;
    expect(beforeStatus).toBe(CardStatus.Untapped);

    const next = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId,
      companyId,
      attachToCharacterId: charId,
    });

    // Character taps as normal — only the site is shielded by the rule.
    const afterChar = next.players[RESOURCE_PLAYER].characters[charId as string];
    expect(afterChar.status).toBe(CardStatus.Tapped);

    const afterSite = next.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(afterSite.status).toBe(CardStatus.Untapped);
  });

  test('baseline: same play at Bandit Lair (no never-taps) DOES tap the site', () => {
    // Bandit Lair (le-351) is a minion ruins-and-lairs with no `never-taps`
    // rule — the same reducer path must tap the site, confirming the rule
    // (not the fixture) is what flips the outcome on The Worthy Hills.
    const state = setupPlayResourcesAt(BANDIT_LAIR_LE);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const charId = charIdAt(state, RESOURCE_PLAYER);
    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);

    const next = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId,
      companyId,
      attachToCharacterId: charId,
    });

    const afterSite = next.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(afterSite.status).toBe(CardStatus.Tapped);
  });

  test('never-taps: resourcePlayed flag still advances after the play', () => {
    // Even when the site does not tap, the per-company `resourcePlayed` flag
    // must still flip so the site-phase flow tracks that a resource was
    // played. The site-tap and the play-accounting are independent.
    const state = setupPlayResourcesAt(THE_WORTHY_HILLS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const charId = charIdAt(state, RESOURCE_PLAYER);
    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);

    const next = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId,
      companyId,
      attachToCharacterId: charId,
    });

    const phase = next.phaseState as SitePhaseState;
    expect(phase.resourcePlayed).toBe(true);
  });

  test('never-taps: two sequential item plays both resolve without tapping the site', () => {
    // The rule's observable effect beyond a single play: a second resource
    // can be played after the first. This test doubles the minor-item path
    // to prove the site-tap gate never engages between the two reductions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: THE_WORTHY_HILLS, characters: [GORBAG, LIEUTENANT_OF_MORGUL] }],
          hand: [SAW_TOOTHED_BLADE, SAW_TOOTHED_BLADE],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = { ...base, phaseState: basePlayResourcesPhaseState(base) };

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const firstCharId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const secondCharId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const firstCardId = handCardId(state, RESOURCE_PLAYER, 0);
    const secondCardId = handCardId(state, RESOURCE_PLAYER, 1);

    const afterFirst = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: firstCardId,
      companyId,
      attachToCharacterId: firstCharId,
    });
    expect(
      afterFirst.players[RESOURCE_PLAYER].companies[0].currentSite!.status,
    ).toBe(CardStatus.Untapped);

    // The phaseState already has `resourcePlayed: true`; the site-tap gate
    // in legal-actions would normally forbid a second play, but driving the
    // reducer directly exercises the tap branch itself — which must remain
    // no-op while the rule is active.
    const afterSecond = dispatch(afterFirst, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: secondCardId,
      companyId,
      attachToCharacterId: secondCharId,
    });
    expect(
      afterSecond.players[RESOURCE_PLAYER].companies[0].currentSite!.status,
    ).toBe(CardStatus.Untapped);
  });

  // ─── Movement: starter from Carn Dûm ───────────────────────────────────────

  test('starter movement from Carn Dûm reaches The Worthy Hills (le-415)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterWorthy = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_WORTHY_HILLS as string),
    );
    expect(starterWorthy).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach The Worthy Hills (le-415)', () => {
    // le-415's nearestHaven is Carn Dûm, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterWorthy = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_WORTHY_HILLS as string),
    );
    expect(starterWorthy).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach The Worthy Hills (le-415)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterWorthy = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_WORTHY_HILLS as string),
    );
    expect(starterWorthy).toBeUndefined();
  });

  test('starter movement from The Worthy Hills returns to Carn Dûm', () => {
    const worthy = pool[THE_WORTHY_HILLS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, worthy, allSites);
    const starterCarnDum = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );
    expect(starterCarnDum).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from The Worthy Hills stays within 4 regions', () => {
    const worthy = pool[THE_WORTHY_HILLS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, worthy, allSites);
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
  });

  test('haven-to-haven movement from Carn Dûm does not include The Worthy Hills (not a haven)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(carnDum.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('The Worthy Hills')).toBe(false);
  });
});
