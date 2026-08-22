/**
 * @module dm-179.test
 *
 * Card test: Noble Hound (dm-179)
 * Type: hero-resource-ally
 *
 * "Playable at any tapped or untapped Border-hold. In all cases, Noble Hound
 * must be assigned a strike before any strike can be assigned to its
 * controlling character. If Noble Hound is tapped or wounded, treat it as
 * though it were untapped for the purposes of assigning strikes.
 * Discard Noble Hound to cancel any effect that would take its controlling
 * character prisoner (does not protect other characters from being taken prisoner)."
 *
 * Engine support:
 *   - play-target with siteType filter (tapped or untapped border-hold): supported
 *   - strike-shield: enforced in assignStrikeActions (must assign to ally first)
 *   - alwaysCountsAsUntapped: ally offered even when tapped/wounded
 *   - cancel-prisoner-taking: NOT IMPLEMENTED — the `cancel-prisoner-taking`
 *     effect type is declared, but no legal action lets the player discard
 *     Noble Hound to cancel a prisoner-taking, and `bindPrisoner`
 *     (combat-hazard-play.ts) never consults it. Because this printed ability
 *     is unimplemented, the card is NOT certified (project policy: no
 *     certified date while any effect is deferred/stubbed/unimplemented).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardStatus, CardDefinitionId, CardInstanceId, Race, SiteType } from '../../index.js';
import type { PlayerState } from '../../index.js';
import {
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, BREE, BANDIT_LAIR,
  buildTestState, findCharInstanceId, companyIdAt,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  resetMint, viableActions, attachAllyToChar, makeShadowMHState,
  buildSitePhaseState, viableActionsForHandCard,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';

const NOBLE_HOUND = 'dm-179' as CardDefinitionId;
const REBUILD_THE_TOWN = 'dm-155' as CardDefinitionId;

describe('dm-179: Noble Hound', () => {
  beforeEach(() => resetMint());

  test('Noble Hound must be assigned a strike before controlling character', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Attach Noble Hound to Aragorn.
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const p1 = withHound.players[RESOURCE_PLAYER];
    const houndId = p1.characters[aragornId]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();

    // Build combat state in assign-strikes phase (defender's turn).
    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes' as const,
      assignmentPhase: 'defender' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...withHound, combat, phaseState: makeShadowMHState() };

    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');

    // Noble Hound should be assignable (it's untapped).
    const houndAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === houndId);
    expect(houndAssign).toBeDefined();

    // Aragorn should NOT be assignable while Noble Hound is unassigned.
    const aragornAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === aragornId);
    expect(aragornAssign).toBeUndefined();
  });

  test('Noble Hound counts as untapped for strike assignment even when tapped', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Attach Noble Hound to Aragorn.
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);

    // Tap Noble Hound.
    const houndId = withHound.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();
    const tappedHound = {
      ...withHound,
      players: withHound.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              allies: p.characters[aragornId].allies.map(a =>
                a.instanceId === houndId ? { ...a, status: CardStatus.Tapped } : a,
              ),
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes' as const,
      assignmentPhase: 'defender' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...tappedHound, combat, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');

    // Noble Hound should still be assignable even when tapped (alwaysCountsAsUntapped).
    const houndAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === houndId);
    expect(houndAssign).toBeDefined();

    // Aragorn is still blocked (Hound not yet assigned).
    const aragornAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === aragornId);
    expect(aragornAssign).toBeUndefined();
  });

  test('Noble Hound counts as untapped for strike assignment even when wounded', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const houndId = withHound.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;

    // Wound Noble Hound.
    const woundedHound = {
      ...withHound,
      players: withHound.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              allies: p.characters[aragornId].allies.map(a =>
                a.instanceId === houndId ? { ...a, status: CardStatus.Inverted } : a,
              ),
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes' as const,
      assignmentPhase: 'defender' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...woundedHound, combat, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');

    // Wounded Noble Hound still assignable (alwaysCountsAsUntapped).
    const houndAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === houndId);
    expect(houndAssign).toBeDefined();
  });

  test('Noble Hound must be assigned a strike before controlling character during an automatic-attack (attacker assignment phase)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId;
    expect(siteInstanceId).toBeDefined();

    // Attach Noble Hound to Aragorn, and wound it (as in the reported game).
    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const houndId = withHound.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();
    const woundedHound = {
      ...withHound,
      players: withHound.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              allies: p.characters[aragornId].allies.map(a =>
                a.instanceId === houndId ? { ...a, status: CardStatus.Inverted } : a,
              ),
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    // Automatic-attacks use the 'attacker' assignment phase — the hazard
    // player picks which defending characters/allies face the strikes.
    const combat = {
      attackSource: { type: 'automatic-attack' as const, siteInstanceId: siteInstanceId as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Wolf,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes' as const,
      assignmentPhase: 'attacker' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...woundedHound, combat, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_2, 'assign-strike');

    // Wounded Noble Hound should still be offered as a strike target.
    const houndAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === houndId);
    expect(houndAssign).toBeDefined();

    // Aragorn should NOT be assignable while Noble Hound is unassigned.
    const aragornAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === aragornId);
    expect(aragornAssign).toBeUndefined();
  });

  test('body-check-roll against Noble Hound uses its own body, not the generic character fallback', () => {
    // Bug report: Gamling's Noble Hound was wounded by Neeker-breekers (its
    // detainment converted to a normal attack by Alatar's "more than 7 stage
    // points" ability), and the resulting body-check-roll legal action
    // displayed "character body 9" instead of Noble Hound's printed body of
    // 6 — the ally lookup was missing from bodyCheckActions, so it fell
    // through to the generic `?? 9` default used for real characters.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const houndId = withHound.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(houndId).toBeDefined();

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 9,
      creatureBody: null,
      creatureRace: Race.Animal,
      strikeAssignments: [{
        characterId: houndId,
        excessStrikes: 0,
        resolved: true,
        result: 'wounded' as const,
        wasAlreadyWounded: false,
      }],
      currentStrikeIndex: 0,
      phase: 'body-check' as const,
      assignmentPhase: 'done' as const,
      bodyCheckTarget: 'character' as const,
      detainment: false,
    };

    const combatState = { ...withHound, combat, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_2, 'body-check-roll');

    expect(actions.length).toBeGreaterThan(0);
    const act = actions[0].action as { need?: number; explanation?: string };
    // Noble Hound's printed body is 6 — need = body + 1 = 7.
    expect(act.explanation).toContain('body 6');
    expect(act.need).toBe(7);
  });

  test('Noble Hound is playable at an untapped border-hold via play-target filter', () => {
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [NOBLE_HOUND],
    });

    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NOBLE_HOUND);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('Noble Hound is not playable at a non-border-hold site', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [NOBLE_HOUND],
    });

    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NOBLE_HOUND);
    expect(actions.length).toBe(0);
  });

  test('Noble Hound is playable at a Ruins & Lairs site converted to Border-hold by Rebuild the Town', () => {
    // Bug report: Noble Hound was not offered at The Worthy Hills (printed
    // Ruins & Lairs) after Rebuild the Town's site-type-override converted it
    // to a Border-hold. The ally branch computed the site's effective type
    // via getEffectiveSiteType but then checked the play-target filter
    // against the site's raw (printed) definition instead of that effective
    // type, so the override was silently ignored for ally playability.
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      characters: [ARAGORN],
      hand: [NOBLE_HOUND],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withOverride = addConstraint(state, {
      source: 'rebuild-src' as CardInstanceId,
      sourceDefinitionId: REBUILD_THE_TOWN,
      scope: { kind: 'until-cleared' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: SiteType.BorderHold,
        filter: { 'site.definitionId': BANDIT_LAIR as string },
      },
    });

    const actions = viableActionsForHandCard(withOverride, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NOBLE_HOUND);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('Noble Hound is playable at a tapped border-hold (requireTapped: false)', () => {
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [NOBLE_HOUND],
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NOBLE_HOUND);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('After Noble Hound is assigned, controlling character can be assigned', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const withHound = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_HOUND);
    const houndId = withHound.players[RESOURCE_PLAYER].characters[aragornId].allies[0].instanceId;

    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 2,
      strikeProwess: 5,
      creatureBody: null,
      creatureRace: Race.Orc,
      // Noble Hound already assigned — Aragorn should now be assignable.
      strikeAssignments: [{ characterId: houndId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'assign-strikes' as const,
      assignmentPhase: 'defender' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    const combatState = { ...withHound, combat, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');

    const aragornAssign = actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === aragornId);
    expect(aragornAssign).toBeDefined();
  });
});
