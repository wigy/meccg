/**
 * @module le-113.test
 *
 * Card test: Greed (le-113) — hazard-event (short)
 *
 * "Playable on a site. Until the end of the turn, each non-Hobbit, non-Wizard,
 *  non-Ringwraith character at the site must make a corruption check each time
 *  an item is played at the site. The character playing an item need not make a
 *  corruption check. When a character makes one of these checks, it is modified
 *  by subtracting the corruption points the item would normally give the
 *  character if he controlled it. Cannot be duplicated on a given site."
 *
 * Effects:
 *   1. play-target site
 *   2. duplication-limit scope:site max:1
 *   3. item-play-corruption-check exemptFilter:{ target.race $in [hobbit,wizard,ringwraith] }
 *
 * Engine support:
 * - The short-event is played on a company's site during the M/H phase and, on
 *   resolution, installs a turn-scoped `item-play-corruption-check`
 *   ActiveConstraint bound to that site (via the chain payload's
 *   `targetSiteDefinitionId`), targeting the resource (item-playing) player.
 * - During the site phase, `fireItemPlayCorruptionChecks` (reducer-site.ts)
 *   fires one corruption check per non-exempt company-mate — everyone except
 *   the item-player and Hobbit/Wizard/Ringwraith characters — each modified by
 *   subtracting the item's printed corruption points.
 * - "Cannot be duplicated on a given site" — the dup-limit scope:site check in
 *   movement-hazard.ts counts the resolved copy's constraint bound to the site.
 * - Per CRF 22: triggered by a special ring item being *played*, not by items
 *   being *transferred* — the trigger rides only the item-play path.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, BILBO, GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  STING, THE_MITHRIL_COAT,
  buildTestState, buildSitePhaseState, buildMinionSitePhaseState, resetMint,
  viableActions, dispatch, resolveChain,
  makeMHState, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type {
  GameState, CardDefinitionId, CardInstanceId,
  PlayHeroResourceAction, PlayHazardAction,
} from '../../index.js';

const GREED = 'le-113' as CardDefinitionId;
const GREED_TW = 'tw-42' as CardDefinitionId;        // The Wizards printing of the same card

// Minion fixtures for the Ringwraith-exemption test (declared locally per the
// card-ids.ts single-use policy).
const KHAMUL = 'le-55' as CardDefinitionId;          // minion-character, ringwraith
const GORBAG = 'le-11' as CardDefinitionId;          // minion-character, orc
const SHAGRAT = 'le-39' as CardDefinitionId;         // minion-character, orc
const ETTENMOORS = 'le-373' as CardDefinitionId;     // minion ruins-and-lairs, minor items
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minion minor item, corruptionPoints 1

// Inline constants for building the turn-scoped Greed constraint bound to a
// site. `siteDefinitionId` is filled in per-test; the rest is fixed data.
const GREED_EXEMPT = { 'target.race': { $in: ['hobbit', 'wizard', 'ringwraith'] } };
const GREED_BASE = {
  source: 'greed-1' as CardInstanceId,
  sourceDefinitionId: GREED,
  scope: { kind: 'turn' as const },
  target: { kind: 'player' as const, playerId: PLAYER_1 },
};

describe('Greed (le-113)', () => {
  beforeEach(() => resetMint());

  // ─── Playability ────────────────────────────────────────────────────────

  test('playable on a company\'s site during the movement/hazard phase', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    // The action binds to the company's current site (Rivendell).
    expect((actions[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(RIVENDELL);
  });

  // ─── Short-event resolution installs the constraint ───────────────────────

  test('resolves to discard and installs a turn-scoped item-play-corruption-check bound to the site', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const greedInstanceId = mhState.players[1].hand[0].instanceId;
    const play = viableActions(mhState, PLAYER_2, 'play-hazard')[0].action;
    const afterResolve = resolveChain(dispatch(mhState, play));

    // Short event: consumed to the hazard player's discard, not in play.
    expect(afterResolve.players[1].hand).toHaveLength(0);
    expect(afterResolve.players[1].cardsInPlay).toHaveLength(0);
    expect(afterResolve.players[1].discardPile.map(c => c.instanceId)).toContain(greedInstanceId);

    // Constraint bound to the site, targeting the resource (item-playing) player.
    const c = afterResolve.activeConstraints.find(k => k.kind.type === 'item-play-corruption-check');
    expect(c).toBeDefined();
    expect(c!.kind).toMatchObject({ type: 'item-play-corruption-check', siteDefinitionId: RIVENDELL });
    expect(c!.scope).toEqual({ kind: 'turn' });
    expect(c!.target).toEqual({ kind: 'player', playerId: PLAYER_1 });
  });

  // ─── Item played at the site triggers corruption checks ───────────────────

  test('an item played at the guarded site forces each non-exempt company-mate to make a corruption check', () => {
    // ARAGORN (dunadan) plays STING (cp 1); GIMLI (dwarf) must check at -1.
    let state: GameState = buildSitePhaseState({ site: MORIA, characters: [ARAGORN, GIMLI], hand: [STING] });
    state = addConstraint(state, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: MORIA, exemptFilter: GREED_EXEMPT } });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const gimliId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    expect(play).toBeDefined();
    const after = dispatch(state, play);

    const checks = after.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    const check = checks[0].kind as { type: 'corruption-check'; characterId: CardInstanceId; modifier: number };
    // GIMLI must check; ARAGORN (the item-player) is exempt.
    expect(check.characterId).toBe(gimliId);
    expect(check.characterId).not.toBe(aragornId);
    expect(check.modifier).toBe(-1);
  });

  test('the check modifier subtracts the item\'s corruption points (cp 2 → -2)', () => {
    // THE_MITHRIL_COAT is a greater item worth 2 corruption points → modifier -2.
    let state: GameState = buildSitePhaseState({ site: MORIA, characters: [ARAGORN, GIMLI], hand: [THE_MITHRIL_COAT] });
    state = addConstraint(state, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: MORIA, exemptFilter: GREED_EXEMPT } });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const gimliId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);

    const checks = after.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    const check = checks[0].kind as { type: 'corruption-check'; characterId: CardInstanceId; modifier: number };
    expect(check.characterId).toBe(gimliId);
    expect(check.modifier).toBe(-2);
  });

  // ─── Exemptions ───────────────────────────────────────────────────────────

  test('Hobbits and Wizards at the site are exempt from the check', () => {
    // Company: Aragorn (item-player, dunadan), Gimli (dwarf → checks),
    // Bilbo (hobbit → exempt), Gandalf (wizard → exempt).
    let state: GameState = buildSitePhaseState({ site: MORIA, characters: [ARAGORN, GIMLI, BILBO, GANDALF], hand: [STING] });
    state = addConstraint(state, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: MORIA, exemptFilter: GREED_EXEMPT } });

    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const gimliId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);

    const checked = after.pendingResolutions
      .filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check')
      .map(r => (r.kind as { characterId: CardInstanceId }).characterId);
    // Only Gimli checks; the hobbit and wizard (and the item-player) are exempt.
    expect(checked).toEqual([gimliId]);
  });

  test('Ringwraiths at the site are exempt from the check', () => {
    // Minion company: Gorbag (item-player, orc), Shagrat (orc → checks),
    // Khamûl (ringwraith → exempt). Gorbag plays Strange Rations (cp 1).
    let state = buildMinionSitePhaseState({
      site: ETTENMOORS,
      characters: [GORBAG, SHAGRAT, KHAMUL],
      hand: [STRANGE_RATIONS],
    });
    state = addConstraint(state, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: ETTENMOORS, exemptFilter: GREED_EXEMPT } });

    const gorbagId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const shagratId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === gorbagId)!;
    expect(play).toBeDefined();
    const after = dispatch(state, play);

    const checks = after.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    const check = checks[0].kind as { type: 'corruption-check'; characterId: CardInstanceId; modifier: number };
    // Only Shagrat (orc) checks; the Ringwraith and the item-player are exempt.
    expect(check.characterId).toBe(shagratId);
    expect(check.modifier).toBe(-1);
  });

  // ─── No constraint / wrong site → no checks ───────────────────────────────

  test('no checks fire when no Greed constraint is bound to the site', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN, GIMLI], hand: [STING] });
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('a Greed bound to a different site does not fire at this site', () => {
    // The constraint is bound to Rivendell, but the company is at Moria — the
    // item play at Moria must not trigger it ("at the site").
    let state: GameState = buildSitePhaseState({ site: MORIA, characters: [ARAGORN, GIMLI], hand: [STING] });
    state = addConstraint(state, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: RIVENDELL, exemptFilter: GREED_EXEMPT } });
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const play = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.attachToCharacterId === aragornId)!;
    const after = dispatch(state, play);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Duplication limit ─────────────────────────────────────────────────────

  test('cannot be duplicated on a given site — second copy rejected once the first is bound', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREED, GREED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    // Play + resolve the first Greed at Rivendell.
    const play1 = viableActions(mhState, PLAYER_2, 'play-hazard')[0].action;
    const afterFirst = resolveChain(dispatch(mhState, play1));
    expect(afterFirst.activeConstraints.some(c => c.kind.type === 'item-play-corruption-check')).toBe(true);

    // The second Greed targets the same site (Rivendell) → no viable play-hazard.
    const second = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(second).toHaveLength(0);
  });

  test('cannot be duplicated across printings — a resolved tw-42 Greed blocks le-113 at the same site', () => {
    // Duplication is by card NAME: Greed exists as both le-113 and tw-42, and
    // a mixed-set deck must not evade the site limit by playing one printing
    // of each. The resolved tw-42 copy leaves its constraint stamped with the
    // tw-42 definition id; the le-113 copy must still see it.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREED_TW, GREED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    // Play + resolve the tw-42 printing at Rivendell.
    const twInstanceId = mhState.players[1].hand.find(c => c.definitionId === GREED_TW)!.instanceId;
    const play1 = viableActions(mhState, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .find(a => a.cardInstanceId === twInstanceId)!;
    const afterFirst = resolveChain(dispatch(mhState, play1));
    expect(afterFirst.activeConstraints.some(c => c.kind.type === 'item-play-corruption-check')).toBe(true);

    // The le-113 printing targets the same site (Rivendell) → no viable play.
    const second = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(second).toHaveLength(0);
  });

  test('a Greed already bound to a different site does not block a fresh copy here', () => {
    // A first Greed already bound to Moria must not stop a fresh Greed from
    // being played on the company at Rivendell ("on a GIVEN site").
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    let mhState: GameState = { ...state, phaseState: makeMHState() };
    mhState = addConstraint(mhState, { ...GREED_BASE, kind: { type: 'item-play-corruption-check', siteDefinitionId: MORIA, exemptFilter: GREED_EXEMPT } });

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(RIVENDELL);
  });
});
