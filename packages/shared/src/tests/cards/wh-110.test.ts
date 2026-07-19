/**
 * @module wh-110.test
 *
 * Card test: Girdle of Radagast (wh-110)
 * Type: minion-resource-event (permanent) · alignment: stage · Stage resource
 *
 * Card text:
 *   "Radagast specific. Playable on one of your protected Wizardhavens [{H}] if
 *    you are Radagast and have at least 12 SPs and 6 allies and/or unique
 *    factions in play (the factions must be playable at sites in the
 *    Wizardhaven's [{H}] region or adjacent regions). The Wizardhaven's region
 *    and all adjacent regions become Wilderness [{w}]. Cannot be duplicated."
 *
 * CRF 22: "Does not affect the regions in starter movement, except for the
 * starting and ending regions." (Region-type change applies to hazard-creature
 * keying on the traversed regions — the per-region-name model handles this.)
 *
 * Modelled effects (see `data/wh-resources.json`):
 *  - `stage-points: 3` — contributes 3 stage points to a Fallen-wizard who has
 *    it in play (summed by `recompute-derived`).
 *  - `play-target` site `{ effectiveSiteType: "haven" }` — only offered while
 *    the active company is at a (Wizard)haven; the play binds the card to that
 *    site (`attachedToSite`).
 *  - `play-condition` player-state `{ player.avatar: "Radagast",
 *    player.stagePoints: { $gte: 12 } }` — "if you are Radagast and have at
 *    least 12 SPs".
 *  - `play-condition` `requires: 'site-protected'` — the Wizardhaven must
 *    already carry a `site-protected` constraint owned by the player.
 *  - `play-condition` `requires: 'supporters-in-region', min: 6` — the player's
 *    allies in play plus unique factions in play playable at a site in the
 *    Wizardhaven's region or an adjacent region must total ≥ 6.
 *  - `region-type-conversion` `{ to: "wilderness", includeAdjacent: true }` —
 *    while in play (anchored to the Wizardhaven via `attachedToSite`), that
 *    region and every adjacent region are treated as Wilderness for hazard
 *    creature keying.
 *  - `duplication-limit` scope `game` — "Cannot be duplicated."
 *
 * Because it is a permanent stage marshalling-point card, it must persist when
 * the company leaves the Wizardhaven — it is exempt from the site-attached
 * orphan sweep (`cardKeepsBoundSitePermanent`).
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | carries 3 stage points (Fallen-wizard only)                   | OK     |
 * | 2 | playable only if your avatar is Radagast                      | OK     |
 * | 3 | playable only on a protected Wizardhaven                      | OK     |
 * | 4 | requires at least 12 stage points                             | OK     |
 * | 5 | requires ≥6 allies and/or in-region unique factions           | OK     |
 * | 6 | the faction count is restricted to the region + adjacents     | OK     |
 * | 7 | the Wizardhaven's region + adjacents become Wilderness (keying)| OK    |
 * | 8 | only the anchored regions are converted                       | OK     |
 * | 9 | cannot be duplicated (game scope)                             | OK     |
 * |10 | persists when the company leaves the Wizardhaven              | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  CardStatus, buildTestState, resetMint, makeMHState,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayerId,
} from '../../index.js';

const GIRDLE = 'wh-110' as CardDefinitionId;
const RHOSGOBEL = 'wh-57' as CardDefinitionId;   // FW Wizardhaven, region "Southern Mirkwood"
const ISENGARD = 'wh-56' as CardDefinitionId;    // FW Wizardhaven, region "Gap of Isen"

const RADAGAST = 'wh-8' as CardDefinitionId;      // Fallen-wizard avatar — qualifies
const ALATAR = 'wh-1' as CardDefinitionId;        // Fallen-wizard avatar — does NOT qualify

// Unique hero factions playable in Southern Mirkwood's region set (adjacents).
const BEORNINGS = 'tw-197' as CardDefinitionId;   // Beorn's House → Anduin Vales (adjacent)
const WOODMEN = 'tw-368' as CardDefinitionId;      // Woodmen-town → Western Mirkwood (adjacent)
// Unique hero faction NOT playable in the region set.
const RIDERS_OF_ROHAN = 'tw-317' as CardDefinitionId; // Rohan

const ALLY = 'td-142' as CardDefinitionId;         // a hero ally (counts toward supporters)
const GIANT = 'tw-39' as CardDefinitionId;         // hazard creature keyed {w}{w}

/** A `site-protected` constraint owned by `owner`, bound to `siteDefId`. */
function siteProtected(owner: PlayerId, siteDefId: CardDefinitionId) {
  return {
    id: `protected-${siteDefId as string}`,
    source: 'protected-src' as CardInstanceId,
    sourceDefinitionId: 'wh-74' as CardDefinitionId,
    scope: { kind: 'until-cleared' as const },
    target: { kind: 'player' as const, playerId: owner },
    kind: { type: 'site-flag' as const, flag: 'site-protected' as const, siteDefinitionId: siteDefId },
  } as unknown as GameState['activeConstraints'][number];
}

/** A Girdle in play, anchored to `siteDefId`. */
function girdleInPlay(siteDefId: CardDefinitionId): CardInPlay {
  return {
    instanceId: 'girdle-in-play' as CardInstanceId,
    definitionId: GIRDLE,
    status: CardStatus.Untapped,
    attachedToSite: siteDefId,
  };
}

/**
 * Fallen-wizard organization-phase state: P1 company at `site` with the given
 * avatar, `stagePoints` set directly, `factions` (and any extra) in play,
 * `allyCount` allies attached to the avatar, and the Girdle in hand. Optionally
 * mark `site` protected for P1.
 */
function orgState(opts: {
  site?: CardDefinitionId;
  avatar?: CardDefinitionId;
  stagePoints?: number;
  factions?: CardDefinitionId[];
  allyCount?: number;
  protectedForP1?: boolean;
  extraInPlay?: CardInPlay[];
}): GameState {
  const site = opts.site ?? RHOSGOBEL;
  const factionsInPlay: CardInPlay[] = (opts.factions ?? []).map((defId, i) => ({
    instanceId: `faction-${i}` as CardInstanceId,
    definitionId: defId,
    status: CardStatus.Untapped,
  }));
  // recompute:false — `recomputeDerived` would reset `stagePoints` (derived from
  // in-play stage cards) to 0; these tests set the stage-point total directly.
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: false,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site, characters: [opts.avatar ?? RADAGAST] }],
        hand: [GIRDLE],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: [...factionsInPlay, ...(opts.extraInPlay ?? [])],
        stagePoints: opts.stagePoints ?? 12,
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

  // Attach allies to the avatar character (allies live on CharacterInPlay).
  const allyCount = opts.allyCount ?? 0;
  if (allyCount > 0) {
    const charId = state.players[RESOURCE_PLAYER].companies[0].characters[0];
    const char = state.players[RESOURCE_PLAYER].characters[charId];
    const allies = Array.from({ length: allyCount }, (_, i) => ({
      instanceId: `ally-${i}` as CardInstanceId,
      definitionId: ALLY,
      status: CardStatus.Untapped,
    }));
    const updatedChar = { ...char, allies };
    const p1 = {
      ...state.players[RESOURCE_PLAYER],
      characters: { ...state.players[RESOURCE_PLAYER].characters, [charId as string]: updatedChar },
    };
    state = { ...state, players: [p1, state.players[1]] as unknown as GameState['players'] };
  }

  if (opts.protectedForP1) {
    state = { ...state, activeConstraints: [siteProtected(PLAYER_1, site)] };
  }
  return state;
}

/** Whether the Girdle is offered as a viable play at the given org-phase state. */
function canPlayGirdle(state: GameState): boolean {
  const inst = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GIRDLE)!.instanceId;
  return computeLegalActions(state, PLAYER_1).some(
    a => a.viable && a.action.type === 'play-permanent-event'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === inst,
  );
}

/** Base M/H state for keying: P1 company (mover) and P2 (hazard player) holding the creature. */
function keyingState(opts: {
  path: [RegionType, string][];
  girdleAnchor?: CardDefinitionId;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GIANT], siteDeck: [RIVENDELL] },
    ],
  });
  let state: GameState = {
    ...base,
    phaseState: makeMHState({
      resolvedSitePath: opts.path.map(([t]) => t),
      resolvedSitePathNames: opts.path.map(([, n]) => n),
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    }),
  };
  if (opts.girdleAnchor) {
    const p1 = { ...state.players[RESOURCE_PLAYER], cardsInPlay: [girdleInPlay(opts.girdleAnchor)] };
    state = { ...state, players: [p1, state.players[1]] as unknown as GameState['players'] };
  }
  return state;
}

function giantPlayable(state: GameState): boolean {
  const inst = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === GIANT)!.instanceId;
  return computeLegalActions(state, PLAYER_2).some(
    a => a.viable && a.action.type === 'play-hazard'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === inst,
  );
}

describe('Girdle of Radagast (wh-110)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: 3 stage points (Fallen-wizard only) ───────────────────────────

  test('contributes 3 stage points to a Fallen-wizard who has it in play', () => {
    // Company sits away from Rhosgobel (which itself grants +1 SP while
    // occupied, wh-57) so only the Girdle's 3 SP are counted; the Girdle stays
    // in play anchored to Rhosgobel even with no company there (rule 10).
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [girdleInPlay(RHOSGOBEL)] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // stagePoints is derived from stage-points effects; recompute via the reducer path.
    expect(recomputeDerived(state).players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('stage points are not accrued by a non-Fallen-wizard player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RHOSGOBEL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [girdleInPlay(RHOSGOBEL)] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(recomputeDerived(state).players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  // ── Rules 2-5: play restrictions ───────────────────────────────────────────

  test('playable at a protected Rhosgobel as Radagast with 12 SPs and 6 allies', () => {
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 6 });
    expect(canPlayGirdle(state)).toBe(true);
  });

  test('NOT playable when your avatar is not Radagast (Alatar)', () => {
    const state = orgState({ avatar: ALATAR, protectedForP1: true, stagePoints: 12, allyCount: 6 });
    expect(canPlayGirdle(state)).toBe(false);
  });

  test('NOT playable with fewer than 12 stage points', () => {
    const state = orgState({ protectedForP1: true, stagePoints: 11, allyCount: 6 });
    expect(canPlayGirdle(state)).toBe(false);
  });

  // Isengard (wh-56) is a Fallen-wizard Wizardhaven that is NOT inherently
  // protected (unlike Rhosgobel wh-57), so it stands in for an unprotected
  // Wizardhaven that only a `site-protected` constraint can protect.
  test('NOT playable on an unprotected Wizardhaven', () => {
    const state = orgState({ site: ISENGARD, protectedForP1: false, stagePoints: 12, allyCount: 6 });
    expect(canPlayGirdle(state)).toBe(false);
  });

  test('NOT playable if the protection is owned by the opponent', () => {
    const base = orgState({ site: ISENGARD, stagePoints: 12, allyCount: 6 });
    const state = { ...base, activeConstraints: [siteProtected(PLAYER_2, ISENGARD)] };
    expect(canPlayGirdle(state)).toBe(false);
  });

  // ── Rule 5: the 6-supporter threshold ──────────────────────────────────────

  test('NOT playable with only 5 supporters', () => {
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 5 });
    expect(canPlayGirdle(state)).toBe(false);
  });

  test('exactly 6 allies satisfies the supporter requirement', () => {
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 6 });
    expect(canPlayGirdle(state)).toBe(true);
  });

  test('allies and in-region unique factions combine toward the count', () => {
    // 4 allies + 2 in-region unique factions = 6.
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 4, factions: [BEORNINGS, WOODMEN] });
    expect(canPlayGirdle(state)).toBe(true);
  });

  // ── Rule 6: faction count is restricted to the region + adjacents ──────────

  test('a unique faction playable OUTSIDE the region set does NOT count', () => {
    // 5 allies + 1 out-of-region unique faction (Rohan) = 5 → not enough.
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 5, factions: [RIDERS_OF_ROHAN] });
    expect(canPlayGirdle(state)).toBe(false);
  });

  test('a unique faction playable INSIDE the region set counts', () => {
    // 5 allies + 1 in-region unique faction (Beornings → Anduin Vales) = 6.
    const state = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 5, factions: [BEORNINGS] });
    expect(canPlayGirdle(state)).toBe(true);
  });

  // ── Rules 7-8: region → Wilderness conversion (creature keying) ────────────

  test('without the Girdle, a {w}{w} creature is NOT keyable through a dark/border path', () => {
    // Southern Mirkwood (dark) + Anduin Vales (border): no Wilderness → Giant unplayable.
    const state = keyingState({ path: [[RegionType.Dark, 'Southern Mirkwood'], [RegionType.Border, 'Anduin Vales']] });
    expect(giantPlayable(state)).toBe(false);
  });

  test('with the Girdle anchored to Rhosgobel, the region + adjacents become Wilderness so a {w}{w} creature is keyable', () => {
    const state = keyingState({
      path: [[RegionType.Dark, 'Southern Mirkwood'], [RegionType.Border, 'Anduin Vales']],
      girdleAnchor: RHOSGOBEL,
    });
    expect(giantPlayable(state)).toBe(true);
    const inst = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === GIANT)!.instanceId;
    const act = computeLegalActions(state, PLAYER_2).find(
      a => a.viable && a.action.type === 'play-hazard' && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === inst,
    );
    expect((act!.action as { keyedBy?: { method: string; value: string } }).keyedBy)
      .toEqual({ method: 'region-type', value: RegionType.Wilderness });
  });

  test('only the anchored regions are converted — an unrelated region is untouched', () => {
    // Path through two regions NOT in Southern Mirkwood's set: they stay non-Wilderness.
    const state = keyingState({
      path: [[RegionType.Dark, 'Gorgoroth'], [RegionType.Shadow, 'Nurn']],
      girdleAnchor: RHOSGOBEL,
    });
    expect(giantPlayable(state)).toBe(false);
  });

  test('a Girdle anchored to a different Wizardhaven converts that other region, not Southern Mirkwood', () => {
    // Anchored to Isengard (Gap of Isen); Southern Mirkwood is untouched.
    const state = keyingState({
      path: [[RegionType.Dark, 'Southern Mirkwood'], [RegionType.Border, 'Anduin Vales']],
      girdleAnchor: ISENGARD,
    });
    expect(giantPlayable(state)).toBe(false);
  });

  // ── Rule 9: cannot be duplicated (game scope) ──────────────────────────────

  test('cannot be duplicated — a copy already in play blocks a second', () => {
    const withCopy = orgState({ protectedForP1: true, stagePoints: 12, allyCount: 6, extraInPlay: [girdleInPlay(RHOSGOBEL)] });
    expect(canPlayGirdle(withCopy)).toBe(false);
  });

  // ── Rule 10: persists when the company leaves the Wizardhaven ───────────────

  test('persists (not swept) when no company occupies the bound Wizardhaven', () => {
    // Girdle bound to Rhosgobel, but the company has moved to a different site.
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [RADAGAST] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [girdleInPlay(RHOSGOBEL)] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const swept = discardOrphanedSiteAttachedEvents(base);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GIRDLE)).toBe(true);
  });
});
