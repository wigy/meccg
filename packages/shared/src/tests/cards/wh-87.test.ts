/**
 * @module wh-87.test
 *
 * Card test: Half-orcs (wh-87)
 * Type: minion-resource-faction · alignment: stage · race: orc · NON-unique
 *       · faction MP 1 · stage points 1 · influence # 10
 *
 * Card text:
 *   "Playable at one of your protected Wizardhavens [{H}] (if tapped or
 *    untapped) if you have A Strident Spawn in play and if the influence check
 *    is greater than 9."
 *
 * Rules modelled (and how):
 *  - "Playable at … Wizardhavens [{H}]" — `playableAt: [{ siteType: "haven" }]`;
 *    a Wizardhaven is a Fallen-wizard site whose effective type is `haven`.
 *  - "(if tapped or untapped)" — `play-flag: playable-at-tapped-site`, which
 *    overrides the default "factions require an untapped site" rule
 *    (the same flag Snaga-hai le-286 uses).
 *  - "one of your protected Wizardhavens" — `play-condition`
 *    `requires: 'site-protected'`: the company's current site must carry an
 *    active `site-protected` constraint owned by the controller (added by a
 *    stage permanent-event such as Guarded Haven wh-74). Protection by the
 *    opponent, or no protection, does not qualify.
 *  - "if you have A Strident Spawn in play" — `play-condition`
 *    `requires: 'card-in-play'`, `cardName: "A Strident Spawn"`, evaluated
 *    against the controller's OWN in-play names (an opponent's copy does not
 *    satisfy it).
 *  - "if the influence check is greater than 9" — `influenceNumber: 10`; the
 *    engine compares `total >= influenceNumber`, so `need = 10 - modifier`.
 *  - stage points — `stage-points: 1` contributes to the Fallen-wizard's
 *    running stage-point total while the faction is in play.
 *  - NON-unique — multiple copies may be in play; the duplicate-in-play gate
 *    must not block a second copy.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | influence-able at an untapped protected Wizardhaven; need=8    | OK     |
 * | 2 | influence # 10 ("> 9"): DI-0 influencer needs 10               | OK     |
 * | 3 | playable at an ALREADY-TAPPED protected Wizardhaven            | OK     |
 * | 4 | NOT playable without A Strident Spawn in play                 | OK     |
 * | 5 | NOT playable when only the OPPONENT has A Strident Spawn       | OK     |
 * | 6 | NOT playable when the site is not protected                   | OK     |
 * | 7 | NOT playable when the site is protected by the opponent       | OK     |
 * | 8 | NOT playable at a non-haven site (even if protected)          | OK     |
 * | 9 | non-unique: a copy already in play does not block a second    | OK     |
 * |10 | contributes 1 stage point while in play                      | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  firstFactionInfluenceAttempt, makeSitePhase, setCompanySiteStatus,
  LORIEN, MORIA,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, ConstraintId, GameState, PlayerId,
} from '../../index.js';

const HALF_ORCS = 'wh-87' as CardDefinitionId;          // the faction under test
const A_STRIDENT_SPAWN = 'wh-61' as CardDefinitionId;   // required-in-play permanent event
const WIZARDHAVEN = LORIEN;                              // Lórien — a haven (Wizardhaven)
const NON_HAVEN = MORIA;                                 // Moria — a shadow-hold (not a haven)

const CIRYAHER = 'le-6' as CardDefinitionId;   // dúnadan, DI 2
const LAGDUF = 'le-18' as CardDefinitionId;    // orc, DI 0
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven (site-deck filler)

/** A `site-protected` active constraint owned by `owner`, bound to `siteDefId`. */
function protectedConstraint(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: 'ho-protect' as ConstraintId,
    source: 'ho-protect-src' as CardInstanceId,
    sourceDefinitionId: A_STRIDENT_SPAWN,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  };
}

/** An in-play instance of `defId` for placement in a player's `cardsInPlay`. */
function inPlayCard(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/**
 * Build a Fallen-wizard site-phase state with one company at `site`, the named
 * influencing characters in it, and Half-orcs in hand. `stridentOwner` (if
 * given) gets A Strident Spawn in play; `protectOwner` (if given) protects
 * `site`.
 */
function buildState(opts: {
  site: CardDefinitionId;
  characters: CardDefinitionId[];
  stridentOwner?: PlayerId;
  protectOwner?: PlayerId;
  siteStatus?: CardStatus;
  extraInPlayP1?: CardInPlay[];
}): GameState {
  const p1InPlay: CardInPlay[] = [...(opts.extraInPlayP1 ?? [])];
  const p2InPlay: CardInPlay[] = [];
  if (opts.stridentOwner === PLAYER_1) p1InPlay.push(inPlayCard(A_STRIDENT_SPAWN, 'strident-p1'));
  if (opts.stridentOwner === PLAYER_2) p2InPlay.push(inPlayCard(A_STRIDENT_SPAWN, 'strident-p2'));

  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.FallenWizard,
        companies: [{ site: opts.site, characters: opts.characters }],
        hand: [HALF_ORCS], siteDeck: [DOL_GULDUR], cardsInPlay: p1InPlay,
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [] }],
        hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: p2InPlay,
      },
    ],
  });

  const withStatus = opts.siteStatus
    ? setCompanySiteStatus(base, RESOURCE_PLAYER, 0, opts.siteStatus)
    : base;

  const constraints = opts.protectOwner
    ? [...withStatus.activeConstraints, protectedConstraint(opts.protectOwner, opts.site)]
    : withStatus.activeConstraints;

  return { ...withStatus, activeConstraints: constraints, phaseState: makeSitePhase() };
}

function halfOrcsId(state: GameState): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HALF_ORCS)!.instanceId;
}

describe('Half-orcs (wh-87)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: positive case — protected Wizardhaven + A Strident Spawn ─────────

  test('influence-able at an untapped protected Wizardhaven with A Strident Spawn; need = 10 - DI', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_1,
    });
    const attempt = firstFactionInfluenceAttempt(state, halfOrcsId(state));
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8); // 10 - DI(2)
  });

  // ── Rule 2: influence # 10 ("greater than 9") ────────────────────────────────

  test('a DI-0 influencer needs a modified roll of 10', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [LAGDUF],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_1,
    });
    const attempt = firstFactionInfluenceAttempt(state, halfOrcsId(state));
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10); // 10 - DI(0)
  });

  // ── Rule 3: tapped or untapped ───────────────────────────────────────────────

  test('playable at an ALREADY-TAPPED protected Wizardhaven (tapped or untapped)', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_1, siteStatus: CardStatus.Tapped,
    });
    const attempt = firstFactionInfluenceAttempt(state, halfOrcsId(state));
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 4: requires A Strident Spawn in play ────────────────────────────────

  test('NOT playable when A Strident Spawn is not in play', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      protectOwner: PLAYER_1, // protected, but no A Strident Spawn anywhere
    });
    expect(firstFactionInfluenceAttempt(state, halfOrcsId(state))).toBeUndefined();
  });

  // ── Rule 5: "you have A Strident Spawn" — your own copy, not the opponent's ───

  test('NOT playable when only the OPPONENT has A Strident Spawn in play', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_2, protectOwner: PLAYER_1,
    });
    expect(firstFactionInfluenceAttempt(state, halfOrcsId(state))).toBeUndefined();
  });

  // ── Rule 6: requires a protected site ────────────────────────────────────────

  test('NOT playable at an unprotected Wizardhaven', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, // A Strident Spawn in play, but site not protected
    });
    expect(firstFactionInfluenceAttempt(state, halfOrcsId(state))).toBeUndefined();
  });

  // ── Rule 7: "your" protected site — not the opponent's protection ────────────

  test('NOT playable when the site is protected by the opponent, not you', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_2,
    });
    expect(firstFactionInfluenceAttempt(state, halfOrcsId(state))).toBeUndefined();
  });

  // ── Rule 8: only a Wizardhaven [{H}] qualifies ───────────────────────────────

  test('NOT playable at a non-haven site even if protected and A Strident Spawn is in play', () => {
    const state = buildState({
      site: NON_HAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_1,
    });
    expect(firstFactionInfluenceAttempt(state, halfOrcsId(state))).toBeUndefined();
  });

  // ── Rule 9: non-unique — a copy already in play does not block ────────────────

  test('non-unique: a copy already in your play area does not block a second', () => {
    const state = buildState({
      site: WIZARDHAVEN, characters: [CIRYAHER],
      stridentOwner: PLAYER_1, protectOwner: PLAYER_1,
      extraInPlayP1: [inPlayCard(HALF_ORCS, 'half-orcs-own-1')],
    });
    const attempt = firstFactionInfluenceAttempt(state, halfOrcsId(state));
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 10: stage points ────────────────────────────────────────────────────

  test('contributes 1 stage point to the Fallen-wizard while in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.FallenWizard,
          companies: [{ site: WIZARDHAVEN, characters: [CIRYAHER] }],
          hand: [], siteDeck: [DOL_GULDUR],
          cardsInPlay: [inPlayCard(HALF_ORCS, 'half-orcs-inplay')],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [] }], hand: [], siteDeck: [DOL_GULDUR],
        },
      ],
    });
    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });
});
