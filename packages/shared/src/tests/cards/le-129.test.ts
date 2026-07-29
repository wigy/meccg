/**
 * @module le-129.test
 *
 * Card test: Plague (le-129)
 * Type: hazard-event (permanent, character-targeting)
 * Text:
 *   "Playable on a non-Ringwraith, non-Wizard, non-Elf character at or moving
 *    to a non-Haven, non-Ruins & Lairs site. At the end of your opponent's
 *    turn, each non-Ringwraith, non-Wizard, non-Elf character at the same site
 *    as the target must make a roll modified by -2. If the result is greater
 *    than the character's body, he is wounded or he is eliminated if he is
 *    already wounded. Discard this card during the target's organization phase
 *    if he is at a Haven/Darkhaven [{H}]."
 *
 * Effects:
 * | # | Effect                                                | Status | Notes                                              |
 * |---|-------------------------------------------------------|--------|----------------------------------------------------|
 * | 1 | play-target: character, race + company.siteType filter | OK     | character-target filter in movement-hazard.ts      |
 * | 2 | on-event end-of-turn: enqueue-site-wound-rolls (-2)    | OK     | fireEndOfTurnSiteWoundRolls (reducer-site.ts)      |
 * | 3 | on-event organization-phase-start: self-discard @haven | OK     | org-start sweep in advanceToOrganization           |
 *
 * "non-Wizard" covers both the hero Istari (race `wizard`) and their
 * Fallen-wizard avatars (race `fallen-wizard`) — they are the same five beings
 * (the le-138 precedent). The target himself stands at his own site, so he is
 * among the characters that must roll.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS, GIMLI, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, dispatch, runActions, makeMHState, makeSitePhase,
  attachHazardToChar, charIdAt, setCharStatus, getCharacter,
  CardStatus, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayHazardAction } from '../../index.js';

const PLAGUE = 'le-129' as CardDefinitionId;

// Hero fixtures — declared locally per the card-ids.ts constants policy.
const HALBARAD = 'tw-162' as CardDefinitionId;   // hero-character, dunadan, body 5
const DORI = 'tw-141' as CardDefinitionId;       // hero-character, dwarf, body 6
// LEGOLAS (tw-168) is an Elf and GANDALF (tw-156) a Wizard — both immune.

const BREE = 'tw-378' as CardDefinitionId;       // hero-site, border-hold (legal Plague site)
const WEATHERTOP = 'tw-436' as CardDefinitionId; // hero-site, ruins-and-lairs (illegal Plague site)

describe('Plague (le-129)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on a non-RW/Wizard/Elf character at a legal site ──────

  test('offered on each non-Elf, non-Wizard character of a company at a border-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD, DORI, LEGOLAS, GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [PLAGUE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const targets = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(targets).toContain(charIdAt(ready, RESOURCE_PLAYER, 0, 0)); // Halbarad
    expect(targets).toContain(charIdAt(ready, RESOURCE_PLAYER, 0, 1)); // Dori
    expect(targets).not.toContain(charIdAt(ready, RESOURCE_PLAYER, 0, 2)); // Legolas — Elf
    expect(targets).not.toContain(charIdAt(ready, RESOURCE_PLAYER, 0, 3)); // Gandalf — Wizard
  });

  test('not offered against a company at a Haven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [HALBARAD, DORI] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [PLAGUE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('not offered against a company at a Ruins & Lairs site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: WEATHERTOP, characters: [HALBARAD, DORI] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [PLAGUE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('offered against a company moving to a legal site (the destination is what counts)', () => {
    // "at or moving to": a company standing in a Haven but moving to Bree is a
    // legal target — the destination site drives the filter.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [HALBARAD], destinationSite: BREE }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [PLAGUE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Bree' }) };

    const targets = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);
    expect(targets).toContain(charIdAt(ready, RESOURCE_PLAYER, 0, 0));
  });

  // ── Rule 2: end-of-turn rolls for everybody at the target's site ───────────

  test('end-of-turn: one -2 roll per non-Elf/Wizard character at the site, threshold = body', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD, DORI, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(
      { ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const next = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });
    expect(next.phaseState.phase).toBe(Phase.EndOfTurn);

    const rolls = next.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(2); // Halbarad (the bearer) and Dori; Legolas is an Elf

    const byTarget = new Map(rolls.map(r => {
      const kind = r.kind as { targetCharacterId?: string; threshold: number; modifiers: readonly { value?: number }[] };
      return [kind.targetCharacterId, kind];
    }));
    const halbaradId = charIdAt(next, RESOURCE_PLAYER, 0, 0) as string;
    const doriId = charIdAt(next, RESOURCE_PLAYER, 0, 1) as string;
    const legolasId = charIdAt(next, RESOURCE_PLAYER, 0, 2) as string;

    expect(byTarget.get(legolasId)).toBeUndefined();
    expect(byTarget.get(halbaradId)!.threshold).toBe(5); // Halbarad's body
    expect(byTarget.get(doriId)!.threshold).toBe(6);     // Dori's body
    for (const kind of byTarget.values()) {
      expect(kind.modifiers).toEqual([{ kind: 'constant', value: -2 }]);
    }
    // Every roll is made by the afflicted character's own controller.
    expect(rolls.every(r => r.actor === PLAYER_1)).toBe(true);
  });

  test('end-of-turn: characters at a different site are untouched', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(
      { ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const next = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });

    const rolls = next.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(1);
    expect((rolls[0].kind as { targetCharacterId?: string }).targetCharacterId)
      .toBe(charIdAt(next, RESOURCE_PLAYER, 0, 0));
    // Gimli sits at Lórien, not Bree — no roll for the hazard player.
    expect(next.pendingResolutions.some(r => r.actor === PLAYER_2)).toBe(false);
  });

  test('end-of-turn: an opposing company standing at the same site catches it too', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BREE, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(
      { ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const next = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });

    const gimliRoll = next.pendingResolutions.find(
      r => r.kind.type === 'dice-check'
        && (r.kind as { targetCharacterId?: string }).targetCharacterId === charIdAt(next, HAZARD_PLAYER, 0, 0),
    );
    expect(gimliRoll).toBeDefined();
    // Gimli's own controller rolls for him.
    expect(gimliRoll!.actor).toBe(PLAYER_2);
    expect((gimliRoll!.kind as { threshold: number }).threshold).toBe(8); // Gimli's body

    // …and that roll is actually offered to (and resolvable by) the hazard
    // player during the resource player's end-of-turn phase.
    expect(viableActions(next, PLAYER_2, 'resolve-dice-check')).toHaveLength(1);
    const rolled = dispatch(
      { ...next, cheatRollTotal: 11 },
      { type: 'resolve-dice-check', player: PLAYER_2, explanation: '' },
    );
    expect(getCharacter(rolled, HAZARD_PLAYER, GIMLI).status).toBe(CardStatus.Inverted);
  });

  // ── Rule 3: roll result — wound, or eliminate an already-wounded character ──

  test('roll greater than body wounds an unwounded character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(
      { ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const atEot = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });
    expect(atEot.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(1);

    // 8 - 2 = 6 > body 5 → wounded.
    const resolved: GameState = dispatch(
      { ...atEot, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(getCharacter(resolved, RESOURCE_PLAYER, HALBARAD).status).toBe(CardStatus.Inverted);
    expect(resolved.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
  });

  test('roll not greater than body leaves the character unharmed', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(
      { ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const atEot = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });

    // 7 - 2 = 5, which is not greater than body 5 → no wound.
    const resolved = dispatch(
      { ...atEot, cheatRollTotal: 7 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(getCharacter(resolved, RESOURCE_PLAYER, HALBARAD).status).toBe(CardStatus.Untapped);
  });

  test('an already-wounded character is eliminated instead of wounded', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const wounded = setCharStatus(base, RESOURCE_PLAYER, HALBARAD, CardStatus.Inverted);
    const withPlague = attachHazardToChar(
      { ...wounded, phaseState: makeSitePhase() }, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER,
    );

    const atEot = dispatch(withPlague, { type: 'pass', player: PLAYER_1 });
    const halbaradId = charIdAt(atEot, RESOURCE_PLAYER, 0, 0);

    const resolved = dispatch(
      { ...atEot, cheatRollTotal: 8 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(resolved.players[RESOURCE_PLAYER].characters[halbaradId]).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(halbaradId);
  });

  // ── Rule 4: self-discard during the target's organization phase at a Haven ──

  test('discarded at the start of the organization phase when the bearer is at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [HALBARAD] }],
          hand: [],
          siteDeck: [BREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(base, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER);

    const afterOrg = runActions(withPlague, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(getCharacter(afterOrg, RESOURCE_PLAYER, HALBARAD).hazards).toHaveLength(0);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === PLAGUE)).toBe(true);
  });

  test('not discarded at the organization phase while the bearer is away from a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [HALBARAD] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withPlague = attachHazardToChar(base, RESOURCE_PLAYER, HALBARAD, PLAGUE, HAZARD_PLAYER);

    const afterOrg = runActions(withPlague, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(getCharacter(afterOrg, RESOURCE_PLAYER, HALBARAD).hazards).toHaveLength(1);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === PLAGUE)).toBe(false);
  });
});
