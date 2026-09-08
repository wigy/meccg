/**
 * @module dm-44.test
 *
 * Card test: Angmar Arises (dm-44)
 * Type: hazard-event (permanent, Environment)
 *
 * Text:
 *   "Any creature that can be keyed to a one single Shadow-land [{s}] may be
 *    keyed to Forochel, Arthedain, Angmar, Gundabad, or Rhudaur. Any creature
 *    that can be keyed to a Dark-domain [{d}] may be keyed to Angmar or
 *    Gundabad. Discard this card when a creature keyed to one of these
 *    regions (not to the region symbol) is defeated."
 *
 * Effects:
 * | # | Effect                   | Rule covered                                            |
 * |---|--------------------------|----------------------------------------------------------|
 * | 1 | region-name-keying-grant | single-Shadow-land creatures → 5 named regions; single-  |
 * |   |                          | Dark-domain creatures → 2 of those names (Angmar/Gundabad)|
 * | 2 | on-event: attack-defeated| discard self when a creature keyed BY NAME to one of the |
 * |   |                          | 5 regions (not merely by the {s}/{d} symbol) is defeated  |
 *
 * `region-name-keying-grant` is a new engine primitive (engine/region-keying.ts
 * `collectRegionNameKeyingGrants` / `extraKeyedToFromRegionNameGrants`):
 * a global permanent environment appends a synthetic `regionNames`-only
 * `CreatureKeyRestriction` to any creature whose own printed `keyedTo` has a
 * `regionTypes` entry that *exactly* matches a grant's `ifRegionTypes` (a
 * creature keyed to a single Shadow-land matches `["shadow"]`; one keyed to
 * *double* Shadow-lands, `["shadow","shadow"]`, does not — CRF: "May not be
 * used to play creatures keyed to double Shadow-lands"). A `when`-gated
 * printed entry (e.g. Elf-lord Revealed in Wrath le-69's Shadow-land keying,
 * active only while Doors of Night is out of play) only contributes the grant
 * while its own gate currently holds. The synthetic entry is never written
 * into `def.keyedTo` itself, so detainment computation (which reads the
 * creature's own printed `keyedTo`) is unaffected — matching the CRF ruling
 * "does not change the region type used to judge whether an attack is
 * detainment or not."
 *
 * The discard trigger reads `combat.attackKeyingRegionNames` (the *declared*
 * by-name keying match), exposed to the on-event `attack-defeated` context as
 * `attack.keyingRegionNames` (combat-finalize.ts) — so defeating a creature
 * that happened to also be keyable to one of the five regions, but was
 * actually played via its own region-type/site-type symbol, does not discard
 * the card.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  viableActions, reduce, resolveChain,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
} from '../../index.js';

const ANGMAR_ARISES = 'dm-44' as CardDefinitionId;
// Elf-lord Revealed in Wrath (le-69): keyedTo [{wilderness,wilderness}, {shadow, when: not DoN}].
const ELF_LORD = 'le-69' as CardDefinitionId;
// Gothmog (td-28): keyedTo [{regionTypes:[dark], siteTypes:[dark-hold]}] — single Dark-domain.
const GOTHMOG = 'td-28' as CardDefinitionId;
// Wild Fell Beast (td-81): keyedTo [{regionTypes:[shadow,shadow]}] — DOUBLE Shadow-land, excluded.
const WILD_FELL_BEAST = 'td-81' as CardDefinitionId;

/** Resource player (PLAYER_1) holds a company; hazard player (PLAYER_2) holds the named hazard. */
function baseState(hazardHand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
}

function handInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

function playHazardActionsFor(state: GameState, defId: CardDefinitionId) {
  const inst = handInstance(state, defId);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === inst && a.viable);
}

describe('Angmar Arises (dm-44)', () => {
  beforeEach(() => resetMint());

  // ─── Grant not active: named-region path does not help ────────────────────

  test('Elf-lord (single Shadow-land keying) is NOT playable via a bare "Angmar" path without Angmar Arises', () => {
    const state: GameState = { ...baseState([ELF_LORD]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free], resolvedSitePathNames: ['Angmar'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(playHazardActionsFor(state, ELF_LORD)).toHaveLength(0);
  });

  test('Gothmog (single Dark-domain keying) is NOT playable via a bare "Gundabad" path without Angmar Arises', () => {
    const state: GameState = { ...baseState([GOTHMOG]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Gundabad'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(playHazardActionsFor(state, GOTHMOG)).toHaveLength(0);
  });

  // ─── Grant active: single-Shadow-land creature → all 5 named regions ───────

  test('with Angmar Arises in play, Elf-lord becomes playable keyed by name to "Angmar"', () => {
    let state: GameState = { ...baseState([ELF_LORD]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free], resolvedSitePathNames: ['Angmar'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);
    const actions = playHazardActionsFor(state, ELF_LORD);
    expect(actions.length).toBeGreaterThan(0);
    const keyed = (actions[0].action as { keyedBy?: { method: string; value: string } }).keyedBy;
    expect(keyed).toEqual({ method: 'region-name', value: 'Angmar' });
  });

  test('with Angmar Arises in play, Elf-lord also becomes playable keyed by name to "Forochel"', () => {
    let state: GameState = { ...baseState([ELF_LORD]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free], resolvedSitePathNames: ['Forochel'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);
    expect(playHazardActionsFor(state, ELF_LORD).length).toBeGreaterThan(0);
  });

  // ─── Grant active: single-Dark-domain creature → only Angmar/Gundabad ──────

  test('with Angmar Arises in play, Gothmog becomes playable keyed by name to "Gundabad"', () => {
    let state: GameState = { ...baseState([GOTHMOG]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Gundabad'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);
    const actions = playHazardActionsFor(state, GOTHMOG);
    expect(actions.length).toBeGreaterThan(0);
    const keyed = (actions[0].action as { keyedBy?: { method: string; value: string } }).keyedBy;
    expect(keyed).toEqual({ method: 'region-name', value: 'Gundabad' });
  });

  test('with Angmar Arises in play, Gothmog is still NOT playable via "Forochel" (Dark-domain grant excludes it)', () => {
    let state: GameState = { ...baseState([GOTHMOG]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Forochel'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);
    expect(playHazardActionsFor(state, GOTHMOG)).toHaveLength(0);
  });

  // ─── Double Shadow-land creatures are excluded from the grant (CRF ruling) ─

  test('Wild Fell Beast (double Shadow-land keying) is NOT granted named-region keying even with Angmar Arises in play', () => {
    let state: GameState = { ...baseState([WILD_FELL_BEAST]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free], resolvedSitePathNames: ['Angmar'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);
    expect(playHazardActionsFor(state, WILD_FELL_BEAST)).toHaveLength(0);
  });

  // ─── Discard trigger: keyed BY NAME to a granted region, then defeated ─────

  test('discards itself when a creature keyed by name to "Angmar" is defeated', () => {
    let state: GameState = { ...baseState([ELF_LORD]), phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Free], resolvedSitePathNames: ['Angmar'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);

    const elfLordId = handCardId(state, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    let combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, elfLordId, targetCompanyId,
      { method: 'region-name', value: 'Angmar' },
    );
    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.attackKeyingRegionNames).toEqual(['Angmar']);

    // Aragorn taps to fight (full prowess 6) and rolls a max 12 → total 18,
    // strictly beating Elf-lord's 15 prowess (a tie would be "ineffectual",
    // not a defeat).
    combatState = runCreatureCombat(combatState, ARAGORN, 12, null, true);
    expect(combatState.combat).toBeNull();
    expect(combatState.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(ANGMAR_ARISES);
    expect(combatState.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(ANGMAR_ARISES);
  });

  test('does NOT discard when a creature is defeated via its own printed region-type keying (not by name)', () => {
    let state: GameState = { ...baseState([ELF_LORD]), phaseState: makeMHState({
      activeCompanyIndex: 0,
      // Two Wildernesses satisfy Elf-lord's own printed {w}{w} keying — no
      // named-region grant involved.
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, ANGMAR_ARISES);

    const elfLordId = handCardId(state, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    let combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, elfLordId, targetCompanyId,
      { method: 'region-type', value: RegionType.Wilderness },
    );
    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.attackKeyingRegionNames ?? []).toEqual([]);

    // Full defeat again (tap to fight), but this attack was never keyed by
    // name — Angmar Arises must stay in play.
    combatState = runCreatureCombat(combatState, ARAGORN, 12, null, true);
    expect(combatState.combat).toBeNull();
    expect(combatState.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(ANGMAR_ARISES);
    expect(combatState.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).not.toContain(ANGMAR_ARISES);
  });

  // ─── Sanity: playing Angmar Arises itself resolves as a permanent environment ─

  test('playing Angmar Arises adds it to cardsInPlay as a permanent event', () => {
    const state: GameState = { ...baseState([ANGMAR_ARISES]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    const inst = handInstance(state, ANGMAR_ARISES);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const r = reduce(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: inst, targetCompanyId: companyId });
    expect(r.error).toBeUndefined();
    const after = resolveChain(r.state);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(ANGMAR_ARISES);
  });
});
