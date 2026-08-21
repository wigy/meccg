/**
 * @module tw-66.test
 *
 * Card test: Mûmak (Oliphant) (tw-66)
 * Type: hazard-creature, non-unique
 * Race: Animals. Two strikes at prowess 12.
 *
 * Card text:
 *   "Animals. Two strikes. May be played keyed to Dagorlad, Gorgoroth, Horse
 *    Plains, Ithilien, Khand, Nûrn, Ûdun; and may also be played at sites in
 *    these regions. May also be played (on the same turn and on the same
 *    company as Corsairs of Umbar) keyed to Andrast, Anfalas, Belfalas,
 *    Lebennin; and at Ruins & Lairs [{R}] and Shadow-holds [{S}] in these
 *    regions. This card has no effect on a minion player."
 *
 * Keying:
 *   - Base: named regions Dagorlad, Gorgoroth, Horse Plains, Ithilien, Khand,
 *     Nûrn, Ûdun (covers any site in those regions too — as-13/as-21/tw-40
 *     precedent: region-name matching already spans every site type).
 *   - Alt: named regions Andrast, Anfalas, Belfalas, Lebennin, gated by a new
 *     `when` context field `hazardsEncountered` — playable only against a
 *     company that has already faced a Corsairs of Umbar (tw-24) attack this
 *     M/H sub-phase ("on the same turn and on the same company as Corsairs
 *     of Umbar").
 *
 * CRF 22 "Card Effect Limitations": Mûmak may not be played if the opponent
 * is a Ringwraith/Sauron player ("has no effect on a minion player").
 *
 * Engine support:
 * | # | Feature                                        | Status      | Notes                                              |
 * |---|-------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Two strikes, prowess 12                        | IMPLEMENTED | structural data                                    |
 * | 2 | Keying: base named regions                     | IMPLEMENTED | regionNames in keyedTo                             |
 * | 3 | Keying: alt regions gated on Corsairs of Umbar | IMPLEMENTED | new `when.hazardsEncountered` `$includes` context  |
 * | 4 | No effect on a minion player                   | IMPLEMENTED | play-restriction unplayable-when opponent.alignment|
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, Phase } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';

const MUMAK = 'tw-66' as CardDefinitionId;

function twoPlayerState(alignment?: Alignment) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: alignment ?? Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [MUMAK],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Mûmak (Oliphant) (tw-66)', () => {
  beforeEach(() => resetMint());

  // ─── Base keying: named regions ────────────────────────────────────────

  test('playable keyed to a base named region (Ithilien) with no Corsairs of Umbar attack faced', () => {
    const state = twoPlayerState();
    const mhState = makeMHState({ resolvedSitePathNames: ['Ithilien'], hazardsEncountered: [] });
    const ready = { ...state, phaseState: mhState };
    const mumakId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === mumakId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
    expect((viable[0].action as PlayHazardAction).keyedBy).toEqual({ method: 'region-name', value: 'Ithilien' });

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, mumakId, companyId, { method: 'region-name', value: 'Ithilien' });
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureRace).toBe('animal');
  });

  test('NOT playable in a region unrelated to either keying set', () => {
    const state = twoPlayerState();
    const mhState = makeMHState({ resolvedSitePathNames: ['Rhudaur'], hazardsEncountered: [] });
    const ready = { ...state, phaseState: mhState };
    const mumakId = handCardId(ready, HAZARD_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === mumakId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Alt keying: gated on a Corsairs of Umbar attack faced this turn ──────

  test('NOT playable in an alt region (Andrast) when Corsairs of Umbar has not attacked this company', () => {
    const state = twoPlayerState();
    const mhState = makeMHState({ resolvedSitePathNames: ['Andrast'], hazardsEncountered: [] });
    const ready = { ...state, phaseState: mhState };
    const mumakId = handCardId(ready, HAZARD_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === mumakId && a.viable);
    expect(viable).toHaveLength(0);
  });

  test('NOT playable in an alt region (Andrast) when a different creature (not Corsairs of Umbar) attacked', () => {
    const state = twoPlayerState();
    const mhState = makeMHState({ resolvedSitePathNames: ['Andrast'], hazardsEncountered: ['Wolves'] });
    const ready = { ...state, phaseState: mhState };
    const mumakId = handCardId(ready, HAZARD_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === mumakId && a.viable);
    expect(viable).toHaveLength(0);
  });

  test('playable in an alt region (Andrast) once Corsairs of Umbar has attacked this company this sub-phase', () => {
    const state = twoPlayerState();
    const mhState = makeMHState({ resolvedSitePathNames: ['Andrast'], hazardsEncountered: ['Corsairs of Umbar'] });
    const ready = { ...state, phaseState: mhState };
    const mumakId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === mumakId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
    expect((viable[0].action as PlayHazardAction).keyedBy).toEqual({ method: 'region-name', value: 'Andrast' });

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, mumakId, companyId, { method: 'region-name', value: 'Andrast' });
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(12);
  });

  // ─── Play restriction: no effect on a minion (Ringwraith) player ──────────

  test('NOT playable against a Ringwraith opponent, even keyed to a base region', () => {
    const state = twoPlayerState(Alignment.Ringwraith);
    const mhState = makeMHState({ resolvedSitePathNames: ['Ithilien'], hazardsEncountered: [] });
    const ready = { ...state, phaseState: mhState };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
