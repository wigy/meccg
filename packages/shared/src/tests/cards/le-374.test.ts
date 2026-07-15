/**
 * @module le-374.test
 *
 * Card test: Geann a-Lisch (le-374)
 * Type: minion-site (haven, Old Pûkel-land)
 * Effects: 3 site-rules —
 *   - deny-character (empty filter, exceptHomesite): no character may be
 *     brought into play here unless this is its home site
 *   - no-storage: resources may never be stored here
 *   - hazard-site-type-override (ruins-and-lairs, path {s}{w}{w}{w}{w}):
 *     counts as a Ruins & Lairs, with the Carn Dûm site path, for playing
 *     and interpreting hazards
 *
 * Card text:
 *   "Site Path From Carn Dûm: {s}{w}{w}{w}{w}. Special: No character may be
 *    brought into play at this site (unless this site is the character's home
 *    site). Resources may never be stored at this site. Geann a-Lisch counts
 *    as a Ruins & Lairs [{R}] for the purposes of playing and interpreting
 *    hazards. Its site path for this purpose, if needed, is the one from Carn
 *    Dûm."
 *
 * Site structural checks (verified from data, not asserted here):
 *   siteType haven; empty sitePath / nearestHaven (correct for a haven);
 *   havenPaths lists Carn Dûm {s}{w}{w}{w}{w}; region Old Pûkel-land;
 *   empty playableResources / automaticAttacks; resource/hazard draws 2/2.
 *
 * Engine support exercised below:
 *   1. deny-character (empty filter) — every character is denied play here
 *      unless the site is its home site (exceptHomesite waiver).
 *   2. no-storage — no store-item action is offered for a company here, and
 *      the reducer rejects a store attempt.
 *   3. hazard-site-type-override — driving a non-moving company's M/H pass
 *      reinterprets the effective site as ruins-and-lairs with the Carn Dûm
 *      site path, so creatures keyed to R&L (site-type) or to a Wilderness in
 *      the path (region-type) become viable, while an off-key creature stays
 *      non-viable. Stripping the rule leaves the site a plain haven that
 *      blocks all three.
 *
 * Certified: 2026-07-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, RIVENDELL, MORIA,
  resetMint, pool,
  buildTestState, dispatch,
  viableActions, viablePlayCharacterActions, nonViablePlayCharacterActions,
  makeMHState,
} from '../test-helpers.js';
import { computeLegalActions, reduce, Phase, Alignment, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CharacterCard, GameState, MovementHazardPhaseState,
  StoreItemAction, SiteCard,
} from '../../index.js';

const GEANN_A_LISCH = 'le-374' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;         // minion haven that DOES allow storing regular items
const GORBAG = 'le-11' as CardDefinitionId;            // orc, homesite Minas Morgul
const LIEUTENANT_OF_DOL_GULDUR = 'le-21' as CardDefinitionId; // troll, homesite Dol Guldur
const OLD_TREASURE = 'as-129' as CardDefinitionId;     // minor item, no storable-at (regular → storable at any haven)

// Hazard creatures used to probe the R&L reinterpretation:
const CHILL_DOUSER = 'dm-106' as CardDefinitionId;     // keyed to {R}/{S} site-types only (isolates site-type keying)
const GIANT = 'le-74' as CardDefinitionId;             // keyed to {w} region only (isolates site-path keying)
const FELL_TURTLE = 'tw-34' as CardDefinitionId;       // keyed to {c} coastal only (off-key at Geann a-Lisch)

/**
 * Build a minion M/H state with player 1's non-moving company at `site`, then
 * dispatch the resource player's `pass` so the reveal-new-site step funnels
 * through enterSetHazardLimitAndAutoAdvance (where hazard-site-type-override is
 * applied) and lands at play-hazards. Player 2 (hazard player) holds `hazards`.
 * Optionally swap the site definition (to strip the site-rule for A/B tests).
 */
function driveNonMovingMH(
  site: CardDefinitionId,
  hazards: CardDefinitionId[],
  siteDefOverride?: SiteCard,
): GameState {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
        hand: [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: hazards,
        siteDeck: [RIVENDELL],
      },
    ],
  });
  if (siteDefOverride) {
    state = { ...state, cardPool: { ...state.cardPool, [site as string]: siteDefOverride } };
  }
  state = { ...state, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0, siteRevealed: false }) };
  return dispatch(state, { type: 'pass', player: PLAYER_1 });
}

/** A copy of the Geann a-Lisch definition with the hazard-site-type-override rule stripped. */
function geannWithoutHazardOverride(): SiteCard {
  const def = pool[GEANN_A_LISCH as string] as SiteCard;
  const effects = (def.effects ?? []).filter(
    e => !(e.type === 'site-rule' && 'rule' in e && e.rule === 'hazard-site-type-override'),
  );
  return { ...def, effects };
}

describe('Geann a-Lisch (le-374)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: deny-character (empty filter, exceptHomesite) ──────────────────

  test('no character may be brought into play at Geann a-Lisch', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [],
          hand: [GORBAG],
          siteDeck: [GEANN_A_LISCH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    // Even an Orc (allowed at other minion darkhavens like Carn Dûm) is denied
    // here — the deny-character filter is empty, so it matches every character.
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
  });

  test('deny-character is waived for a character whose home site is Geann a-Lisch (exceptHomesite)', () => {
    // No real character has this home site, so override Gorbag's homesite in a
    // per-state cardPool to exercise the exception branch.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [],
          hand: [GORBAG],
          siteDeck: [GEANN_A_LISCH],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    const homeGorbag: CharacterCard = {
      ...(pool[GORBAG as string] as CharacterCard),
      homesite: 'Geann a-Lisch',
    };
    const state: GameState = {
      ...base,
      cardPool: { ...base.cardPool, [GORBAG as string]: homeGorbag },
    };

    const gorbagId = state.players[0].hand[0].instanceId;
    const plays = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === gorbagId);
    expect(plays.length).toBeGreaterThan(0);
  });

  // ─── Rule 2: no-storage ─────────────────────────────────────────────────────

  test('a regular item cannot be stored at Geann a-Lisch (no-storage), though it can at Carn Dûm', () => {
    const makeState = (site: CardDefinitionId): GameState => buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site, characters: [{ defId: LIEUTENANT_OF_DOL_GULDUR, items: [OLD_TREASURE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    // Carn Dûm is a haven → a regular minor item is normally storable there.
    const atCarnDum = computeLegalActions(makeState(CARN_DUM), PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(atCarnDum.length).toBeGreaterThan(0);

    // Geann a-Lisch is also a haven, but no-storage suppresses every store offer.
    const atGeann = computeLegalActions(makeState(GEANN_A_LISCH), PLAYER_1)
      .filter(ea => ea.action.type === 'store-item');
    expect(atGeann).toHaveLength(0);
  });

  test('the reducer rejects a store-item attempt at Geann a-Lisch', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: GEANN_A_LISCH, characters: [{ defId: LIEUTENANT_OF_DOL_GULDUR, items: [OLD_TREASURE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    const charId = state.players[0].companies[0].characters[0];
    const itemInstId = state.players[0].characters[charId].items[0].instanceId;
    const attempted: StoreItemAction = {
      type: 'store-item', player: PLAYER_1, itemInstanceId: itemInstId, characterId: charId,
    };

    // The reducer rejects the action with an error and leaves state untouched:
    // the item stays on the character and nothing is stored.
    const result = reduce(state, attempted);
    expect(result.error).toMatch(/never be stored at Geann a-Lisch/);
    expect(result.state.players[0].characters[charId].items).toHaveLength(1);
    expect(result.state.players[0].killPile).toHaveLength(0);
  });

  // ─── Rule 3: hazard-site-type-override (counts as R&L for hazards) ───────────

  test('driving the M/H pass reinterprets the site as ruins-and-lairs with the Carn Dûm path', () => {
    const after = driveNonMovingMH(GEANN_A_LISCH, []);
    const ps = after.phaseState as MovementHazardPhaseState;

    expect(ps.destinationSiteType).toBe('ruins-and-lairs');
    // Site path from Carn Dûm: {s}{w}{w}{w}{w}.
    expect(ps.resolvedSitePath).toEqual([
      RegionType.Shadow, RegionType.Wilderness, RegionType.Wilderness,
      RegionType.Wilderness, RegionType.Wilderness,
    ]);
  });

  test('a Ruins & Lairs-keyed creature (Chill Douser) is viable against a company at Geann a-Lisch', () => {
    const after = driveNonMovingMH(GEANN_A_LISCH, [CHILL_DOUSER]);
    const plays = viableActions(after, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('a Wilderness-keyed creature (Giant) is viable via the reinterpreted Carn Dûm site path', () => {
    const after = driveNonMovingMH(GEANN_A_LISCH, [GIANT]);
    const plays = viableActions(after, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('an off-key creature (Fell Turtle, coastal) stays non-viable at Geann a-Lisch', () => {
    const after = driveNonMovingMH(GEANN_A_LISCH, [FELL_TURTLE]);
    // A coastal-keyed creature matches neither the R&L site-type nor any
    // Shadow/Wilderness in the reinterpreted path.
    expect(viableActions(after, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('without the hazard-site-type-override rule, Geann a-Lisch is a plain haven that blocks the same creatures', () => {
    const plainDef = geannWithoutHazardOverride();
    const after = driveNonMovingMH(GEANN_A_LISCH, [CHILL_DOUSER, GIANT], plainDef);
    const ps = after.phaseState as MovementHazardPhaseState;

    // The site keeps its printed haven type and empty path → no keying possible.
    expect(ps.destinationSiteType).toBe('haven');
    expect(ps.resolvedSitePath).toEqual([]);
    expect(viableActions(after, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
