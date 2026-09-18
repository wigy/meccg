/**
 * @module dm-112.test
 *
 * Card test: Umagaur the Pale (dm-112)
 * Type: hazard-creature (Troll), unique. Strikes 1, prowess 14, body 8,
 * kill MP 2.
 *
 * Card text:
 *   "Unique. Troll. One strike. Also playable at Moria and The Under-gates.
 *    If Doors of Night is in play, playable at any Under-deeps site. Any
 *    non-unique Orc or Troll hazard creature can be played (not counting
 *    against the hazard limit) on a company that has faced Umagaur that
 *    turn."
 *
 * Engine Support:
 * | # | Rule                                                        | Encoding                                                            |
 * |---|--------------------------------------------------------------|----------------------------------------------------------------------|
 * | 1 | Base keying: Shadow-hold [{S}]                                | keyedTo siteTypes: ["shadow-hold"]                                    |
 * | 2 | "Also playable at Moria and The Under-gates"                  | keyedTo siteNames: ["Moria", "The Under-gates"]                       |
 * | 3 | "If Doors of Night is in play, ... any Under-deeps site"      | keyedTo siteKeywords: ["under-deeps"], when inPlay Doors of Night     |
 * | 4 | "Any non-unique Orc or Troll ... not counting against the     | grant-creature-keying, source: "faced-this-turn",                    |
 * |   | hazard limit ... company that has faced Umagaur that turn"    | hazardLimitExempt: true, creatureFilter race in [orc,troll] +         |
 * |   |                                                               | unique $ne true, siteFilter {} (any site)                             |
 *
 * `hazardLimitExempt` (a new `GrantCreatureKeyingEffect` field) and the
 * "an empty `siteFilter` matches any site" convention were added for this
 * card and are shared with any future grant that both widens keying and
 * exempts the hazard limit for a "has faced X this turn" clause — e.g.
 * Bûthrakaur the Green (dm-105), printed with identical text.
 *
 * Moria (ba-93) and The Under-gates (ba-100) each have a *haven* printing,
 * distinct from their Shadow-hold printings (tw-413/dm-38/as-165/le-392) —
 * that's what makes the named-site clause meaningful rather than redundant
 * with the Shadow-hold base cost.
 *
 * Playable: YES
 * Certified: 2026-09-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, findHandCardId, companyIdAt, findCharInstanceId,
  viableActions, addCardInPlay, dispatch, executeAction, phaseStateAs,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayHazardAction,
} from '../../index.js';

const UMAGAUR = 'dm-112' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const BOROMIR = 'tw-134' as CardDefinitionId; // hero warrior, prowess 6, body 7
/** Orc-raiders (le-85): non-unique Orc, keyed to Wilderness/Border regions or Ruins & Lairs — no native keying at a Shadow-hold. */
const ORC_RAIDERS = 'le-85' as CardDefinitionId;
/** Gothmog (td-28): unique Troll, keyed to Dark-domain / Dark-hold. */
const GOTHMOG = 'td-28' as CardDefinitionId;

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

/** Build a Movement/Hazard state: P1 (hero, moving) vs P2 (hazard, holding the given hand). */
function setup(opts: {
  destinationSiteName: string;
  destinationSiteType: SiteType;
  resolvedSitePath?: readonly RegionType[];
  hazardHand?: readonly CardDefinitionId[];
  doorsOfNight?: boolean;
  hazardsEncountered?: readonly string[];
  hazardsPlayedThisCompany?: number;
  hazardLimitAtReveal?: number;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BOROMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [...(opts.hazardHand ?? [UMAGAUR])], siteDeck: [] },
    ],
  });
  const withDon = opts.doorsOfNight ? addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT) : base;
  return {
    ...withDon,
    phaseState: makeMHState({
      resolvedSitePath: opts.resolvedSitePath ?? [],
      resolvedSitePathNames: [],
      destinationSiteType: opts.destinationSiteType,
      destinationSiteName: opts.destinationSiteName,
      hazardsEncountered: opts.hazardsEncountered ?? [],
      hazardsPlayedThisCompany: opts.hazardsPlayedThisCompany ?? 0,
      hazardLimitAtReveal: opts.hazardLimitAtReveal ?? 4,
    }),
  };
}

describe('Umagaur the Pale (dm-112)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: base keying — Shadow-hold [{S}] ────────────────────────────────

  test('playable at The Under-gates (Shadow-hold printing, base keying)', () => {
    const state = setup({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold });
    expect(viableActions(state, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, SHADOW_HOLD_KEYING);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('troll');
  });

  // ─── Rule 2: "Also playable at Moria and The Under-gates" ──────────────────
  // (their *haven* printings — ba-93 / ba-100 — not covered by the Shadow-hold
  // base cost)

  test('playable at Moria (haven printing) via named-site keying', () => {
    const state = setup({ destinationSiteName: 'Moria', destinationSiteType: SiteType.Haven });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, creatureId, companyId, { method: 'site-name', value: 'Moria' },
    );
    expect(after.combat).not.toBeNull();
  });

  test('playable at The Under-gates (haven printing) via named-site keying', () => {
    const state = setup({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.Haven });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, creatureId, companyId, { method: 'site-name', value: 'The Under-gates' },
    );
    expect(after.combat).not.toBeNull();
  });

  test('NOT playable at another haven (Lórien) without Doors of Night', () => {
    const state = setup({ destinationSiteName: 'Lórien', destinationSiteType: SiteType.Haven });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 3: Doors of Night — playable at any Under-deeps site ─────────────

  test('with Doors of Night in play, playable at The Under-vaults (any Under-deeps site)', () => {
    const state = setup({
      destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs, doorsOfNight: true,
    });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, creatureId, companyId, { method: 'site-keyword', value: 'under-deeps' },
    );
    expect(after.combat).not.toBeNull();
  });

  test('without Doors of Night, The Under-vaults stays unkeyable', () => {
    const state = setup({ destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 4: non-unique Orc/Troll creatures play free of the hazard limit
  //     against a company that has faced Umagaur this turn ───────────────────

  test('a non-unique Orc creature is offered hazard-limit-exempt at a site it could not otherwise key to', () => {
    const state = setup({
      destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold, // no native Orc-raiders keying here
      hazardHand: [ORC_RAIDERS],
      hazardsEncountered: ['Umagaur the Pale'],
      hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4, // hazard limit already reached
    });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => a.keyedBy?.method === 'keying-bypass')).toBe(true);
    expect(plays.every(a => a.keyedBy?.hazardLimitExempt === true)).toBe(true);
  });

  test('without having faced Umagaur, the same Orc creature has no keying at a Shadow-hold', () => {
    const state = setup({
      destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold,
      hazardHand: [ORC_RAIDERS],
    });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as PlayHazardAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('a unique Troll creature (Gothmog) is not exempted from the hazard limit even when natively keyed', () => {
    // Gothmog is natively keyable at a Dark-hold in a Dark-domain, so keying
    // itself is never the blocker here — isolating the uniqueness exclusion.
    const state = setup({
      destinationSiteName: 'Dol Guldur', destinationSiteType: SiteType.DarkHold,
      resolvedSitePath: [RegionType.Dark],
      hazardHand: [GOTHMOG],
      hazardsEncountered: ['Umagaur the Pale'],
      hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4, // hazard limit already reached
    });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as PlayHazardAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('end to end: after Umagaur attacks, a non-unique Orc creature attacks the same company free of the hazard limit', () => {
    const state = setup({
      destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold,
      hazardHand: [UMAGAUR, ORC_RAIDERS],
      hazardLimitAtReveal: 1, // Umagaur's own play exhausts the limit
    });
    const umagaurId = findHandCardId(state, HAZARD_PLAYER, UMAGAUR);
    const orcId = findHandCardId(state, HAZARD_PLAYER, ORC_RAIDERS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(state, PLAYER_2, umagaurId, companyId, SHADOW_HOLD_KEYING);

    // Resolve Umagaur's single strike against Boromir with a low roll (2):
    // characterTotal = 3 (untapped prowess) + 2 = 5, well under Umagaur's
    // prowess 14 — the strike succeeds, Boromir is wounded and faces a body
    // check, rolled low (1) so he survives (wounded, not eliminated). The
    // sole strike's resolution then finalizes the combat.
    const boromirId = findCharInstanceId(afterChain, RESOURCE_PLAYER, BOROMIR);
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: boromirId });
    const chooseAction = computeLegalActions(s, PLAYER_1).find(ea => ea.viable && ea.action.type === 'choose-strike-order');
    if (chooseAction) s = dispatch(s, chooseAction.action);
    const afterStrike = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 1);
    expect(s.combat).toBeNull();

    const mh = phaseStateAs<MovementHazardPhaseState>(s);
    expect(mh.hazardsEncountered).toContain('Umagaur the Pale');
    expect(mh.hazardsPlayedThisCompany).toBe(1); // Umagaur's own play counted normally, exhausting the limit of 1

    const orcPlays = viableActions(s, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === orcId);
    expect(orcPlays.length).toBeGreaterThan(0);
    const chosen = orcPlays[0];
    expect(chosen.keyedBy?.hazardLimitExempt).toBe(true);

    const afterOrc = playCreatureHazardAndResolve(s, PLAYER_2, orcId, companyId, chosen.keyedBy!);
    expect(afterOrc.combat).not.toBeNull();
    expect(afterOrc.combat!.creatureRace).toBe('orc');

    const mh2 = phaseStateAs<MovementHazardPhaseState>(afterOrc);
    expect(mh2.hazardsPlayedThisCompany).toBe(1); // did not increment — hazard-limit exempt
  });
});
