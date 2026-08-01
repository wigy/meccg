/**
 * @module tw-361.test
 *
 * Card test: Wizard's Flame (tw-361)
 * Type: hero-resource-event (short, spell), alignment wizard, 0 MP
 *
 * Card text:
 *   "Spell. Wizard only. All attacks against Wizard's company suffer a -2
 *    modification to prowess for the rest of the turn. Wizard makes a
 *    corruption check modified by -3."
 *
 * A plain resource short event with no move/draw/combat shape, so it
 * resolves inline in `handlePlayResourceShortEvent` rather than riding the
 * chain of effects.
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                          |
 * |---|---------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Wizard only                                      | IMPLEMENTED | play-target filter target.race wizard          |
 * | 2 | Not offered without a Wizard in play              | IMPLEMENTED | same play-target filter                        |
 * | 3 | All attacks (any race) against Wizard's company   | IMPLEMENTED | on-event self-enters-play → add-constraint     |
 * |   | get -2 prowess for the rest of the turn           |             | creature-attack-boost (race omitted)           |
 * | 4 | Boost is scoped to the Wizard's own company only  | IMPLEMENTED | constraint target: company                     |
 * | 5 | Reaches hazard-creature attacks                   | IMPLEMENTED | resolveAttackProwess via attackBoostCtx         |
 * | 6 | Reaches site automatic-attacks                    | IMPLEMENTED | same resolver path, isAutomaticAttack=true      |
 * | 7 | Wizard makes a corruption check modified by -3    | IMPLEMENTED | on-event self-enters-play → enqueue-corruption- |
 * |   |                                                   |             | check                                          |
 * | 8 | Card discarded after play                         | IMPLEMENTED | inline resolution → discardOrRecyclePlayedEvent |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, dispatch,
  makeMHState,
  playCreatureHazardAndResolve,
  buildSitePhaseState, setupAutoAttackStep,
  findCharInstanceId, companyIdAt,
  expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const WIZARDS_FLAME = 'tw-361' as CardDefinitionId;
/** Orc-patrol — 3 strikes at prowess 6; not keyed to any special boost. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;
/** Weathertop — hero Ruins & Lairs whose automatic-attack is Wolves 2x6. */
const WEATHERTOP = 'tw-436' as CardDefinitionId;

/** A path keying Orc-patrol ({w}{s}{d} region types, per its keyedTo) ending at a Ruins & Lairs. */
const orcPath = () => makeMHState({
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

/**
 * Two-company M/H setup with Wizard's Flame in hand and an Orc-patrol in the
 * hazard hand, stopped at the 'play-hazards' step (so the resource player's
 * generic short-event menu — `heroResourceShortEventActions` — is live) on a
 * path that already keys Orc-patrol.
 */
const setup = () => ({
  ...buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site: MORIA, characters: [GANDALF, ARAGORN] },
          { site: RIVENDELL, characters: [FRODO] },
        ],
        hand: [WIZARDS_FLAME],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
    ],
  }),
  phaseState: orcPath(),
});

describe("Wizard's Flame (tw-361)", () => {
  beforeEach(() => resetMint());

  test('offered during M/H, targeting the Wizard', () => {
    const state = setup();
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayShortEventAction;
    expect(action.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF));
  });

  test('NOT playable without a Wizard in play (Spell. Wizard only.)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [WIZARDS_FLAME], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('resolves inline: installs a race-agnostic -2 prowess boost on the Wizard\'s company, enqueues a -3 corruption check, and discards the card', () => {
    const state = setup();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const gandalfCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, plays[0].action);

    // No chain: the card resolves immediately.
    expect(after.chain).toBeNull();
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WIZARDS_FLAME);

    const boosts = after.activeConstraints.filter(c => c.kind.type === 'creature-attack-boost');
    expect(boosts).toHaveLength(1);
    expect(boosts[0].scope).toEqual({ kind: 'turn' });
    expect(boosts[0].target).toEqual({ kind: 'company', companyId: gandalfCompanyId });
    if (boosts[0].kind.type === 'creature-attack-boost') {
      expect(boosts[0].kind.race).toBeUndefined();
      expect(boosts[0].kind.prowess).toBe(-2);
      expect(boosts[0].kind.strikes).toBe(0);
    }

    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    const cc = after.pendingResolutions[0].kind as { type: 'corruption-check'; modifier: number; characterId: string };
    expect(cc.modifier).toBe(-3);
    expect(cc.characterId).toBe(gandalfId);
  });

  test('a hazard-creature attack against the Wizard\'s company has -2 prowess (6 → 4)', () => {
    const state = setup();
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, plays[0].action);

    const orcId = afterPlay.players[1].hand.find(c => c.definitionId === ORC_PATROL)!.instanceId;
    const after = playCreatureHazardAndResolve(
      afterPlay, PLAYER_2, orcId, companyIdAt(afterPlay, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(4);
    expect(after.combat!.strikesTotal).toBe(3);
  });

  test('control: without playing the spell, the same attack is at printed prowess 6', () => {
    const state = { ...setup(), phaseState: orcPath() };
    const orcId = state.players[1].hand.find(c => c.definitionId === ORC_PATROL)!.instanceId;
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, orcId, companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(after.combat!.strikeProwess).toBe(6);
  });

  test('the boost does not leak to the Wizard\'s other companies', () => {
    const state = setup();
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, plays[0].action);

    // Frodo's company (index 1) never received the constraint.
    const frodoCompanyId = afterPlay.players[0].companies[1].id;
    const boosts = afterPlay.activeConstraints.filter(c => c.kind.type === 'creature-attack-boost');
    expect(boosts.every(c => c.target.kind === 'company' && c.target.companyId !== frodoCompanyId)).toBe(true);
  });

  test('"all attacks" reaches site automatic-attacks too: Weathertop\'s Wolves attack at 6 → 4', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: WEATHERTOP, characters: [ARAGORN, LEGOLAS] }));
    const printed = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(printed.combat!.strikeProwess).toBe(6);

    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withBoost = addConstraint(base, {
      source: 'flame-instance-1' as never,
      sourceDefinitionId: WIZARDS_FLAME,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'creature-attack-boost', strikes: 0, prowess: -2 },
    });
    const boosted = dispatch(withBoost, { type: 'pass', player: PLAYER_1 });
    expect(boosted.combat!.strikeProwess).toBe(4);
    expect(boosted.combat!.strikesTotal).toBe(2);
  });
});
