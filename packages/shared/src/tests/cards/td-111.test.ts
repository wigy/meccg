/**
 * @module td-111.test
 *
 * Card test: Elf-path (td-111)
 * Type: hero-resource-event (short, wizard alignment)
 * Effects: 3
 *   1. play-window: organization, step end-of-org (playable throughout the org
 *      phase — end-of-org cards do not lock the phase, CoE 2.II.7)
 *   2. play-target character, DSL filter { target.race: elf, target.status:
 *      untapped }, cost { tap: character }
 *   3. on-event self-enters-play → add-constraint
 *      only-creatures-keyed-to-site-if-safe-path, scope:turn (target company
 *      resolved from the tapped Elf, per `reducer-events.ts`'s
 *      targetScoutInstanceId/targetCharacterId company lookup)
 *
 * Text:
 *   "Playable only at the end of the organization phase. Tap an Elf. If his
 *    company's site path only has one or two regions with no Dark-domains
 *    [{d}] and no Shadow-lands [{s}], opponent may only play hazard creatures
 *    this turn that are keyed to the company's new site."
 *
 * Like Secret Passage (tw-325) / Down Down to Goblin-town (le-181), Elf-path
 * installs a constraint that restricts the opponent to hazard creatures keyed
 * to the protected company's new site (by site-type or site-name), dropping
 * region-keyed creatures. Unlike those two, the gate is neither unconditional
 * (Secret Passage) nor destination-site-type-based (le-181): it reads the
 * company's *resolved site path* — the restriction only bites when the path
 * is exactly one or two regions and contains no Dark-domain or Shadow-land.
 * Otherwise the card is inert for the rest of the turn.
 *
 * Engine Support:
 * | # | Rule (card text)                                       | Status      | Mechanism                                                      |
 * |---|---------------------------------------------------------|-------------|------------------------------------------------------------------|
 * | 1 | Playable only at the end of the organization phase       | IMPLEMENTED | play-window phase:organization                                   |
 * | 2 | Tap an Elf                                               | IMPLEMENTED | play-target character filter {target.race:elf}, cost {tap:character} |
 * | 3 | If his company's site path is 1-2 regions, no Dark/Shadow | IMPLEMENTED | only-creatures-keyed-to-site-if-safe-path gate (resolvedSitePath) |
 * | 4 | ...opponent may only play creatures keyed to new site    | IMPLEMENTED | isCreatureKeyedToDestinationSite allow-list                      |
 * | 5 | (inert when path is longer or crosses Dark/Shadow)       | IMPLEMENTED | gate returns base unchanged                                      |
 * | 6 | "his company" — the tapped Elf's own company             | IMPLEMENTED | company resolved from targetScoutInstanceId/targetCharacterId    |
 *
 * Playable: YES
 * Certified: 2026-08-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE, HOBGOBLINS,
  RIVENDELL, MINAS_TIRITH,
  makeMHState, mint,
  viableActions, dispatch,
  companyIdAt, charIdAt, findHandCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus,
} from '../test-helpers.js';
import { Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const ELF_PATH = 'td-111' as CardDefinitionId;
// Region-only keyed creature ({w}) — never site-keyed. Used to probe the
// safe-path gate independently of Cave-drake's own two-wilderness requirement.
const HUORN = 'le-79' as CardDefinitionId;
// Minion haven sites, used only as P2's (hazard-side) home/site-deck filler.
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/**
 * Org-phase state: P1 (Wizard) has the given characters in a company at
 * Rivendell and holds Elf-path; P2 (Ringwraith) holds the given hazard hand.
 */
function orgState(characters: readonly CardDefinitionId[], hazardHand: readonly CardDefinitionId[] = []) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [...characters] }], hand: [ELF_PATH], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [] }], hand: [...hazardHand], siteDeck: [MINAS_MORGUL] },
    ],
  });
}

/** M/H phase state for the active moving (protected) company on a given path. */
function mhAt(resolvedSitePath: readonly RegionType[], resolvedSitePathNames: readonly string[]) {
  return makeMHState({
    activeCompanyIndex: 0,
    resolvedSitePath,
    resolvedSitePathNames,
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
}

describe('Elf-path (td-111)', () => {
  beforeEach(() => resetMint());

  test('playable at the end of the organization phase on an untapped Elf', () => {
    const base = orgState([LEGOLAS]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ELF_PATH);
    const legolasId = charIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(legolasId);
  });

  test('not playable when the company has no Elf', () => {
    const base = orgState([ARAGORN]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ELF_PATH);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it taps the Elf and adds the safe-path constraint to his company (turn scope)', () => {
    const base = orgState([LEGOLAS]);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ELF_PATH);
    const legolasId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: legolasId,
    });

    expect(next.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind.type).toBe('only-creatures-keyed-to-site-if-safe-path');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('safe path (two Wildernesses, no Dark/Shadow): region-keyed creature is blocked, site-keyed creature survives', () => {
    const base = orgState([LEGOLAS], [HOBGOBLINS, CAVE_DRAKE]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atSafePath = { ...base, phaseState: mhAt([RegionType.Wilderness, RegionType.Wilderness], ['Hithaeglir', 'Hithaeglir']) };

    const hobId = findHandCardId(atSafePath, HAZARD_PLAYER, HOBGOBLINS);
    const drakeId = findHandCardId(atSafePath, HAZARD_PLAYER, CAVE_DRAKE);

    // Baseline: both creatures are legally playable against the company.
    const before = viableActions(atSafePath, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const beforeIds = new Set(before.map(a => a.cardInstanceId));
    expect(beforeIds.has(hobId)).toBe(true);
    expect(beforeIds.has(drakeId)).toBe(true);

    const constrained = addConstraint(atSafePath, {
      source: mint(),
      sourceDefinitionId: ELF_PATH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-if-safe-path' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const afterIds = new Set(after.map(a => a.cardInstanceId));
    expect(afterIds.has(hobId)).toBe(false);
    expect(afterIds.has(drakeId)).toBe(true);
  });

  test('path too long (three regions, still no Dark/Shadow): the card is inert', () => {
    const base = orgState([LEGOLAS], [HUORN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atLongPath = {
      ...base,
      phaseState: mhAt(
        [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
        ['Hithaeglir', 'Hithaeglir', 'Hithaeglir'],
      ),
    };
    const huornId = findHandCardId(atLongPath, HAZARD_PLAYER, HUORN);

    // Baseline: Huorn ({w}) is legally playable via any of the three wildernesses.
    const before = viableActions(atLongPath, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId && a.cardInstanceId === huornId);
    expect(before.length).toBeGreaterThan(0);

    const constrained = addConstraint(atLongPath, {
      source: mint(),
      sourceDefinitionId: ELF_PATH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-if-safe-path' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    expect(after.some(a => a.cardInstanceId === huornId)).toBe(true);
  });

  test('path crosses a Shadow-land (two regions): the card is inert', () => {
    const base = orgState([LEGOLAS], [HUORN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atShadowPath = { ...base, phaseState: mhAt([RegionType.Wilderness, RegionType.Shadow], ['Hithaeglir', 'Mirkwood']) };
    const huornId = findHandCardId(atShadowPath, HAZARD_PLAYER, HUORN);

    const constrained = addConstraint(atShadowPath, {
      source: mint(),
      sourceDefinitionId: ELF_PATH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-if-safe-path' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    expect(after.some(a => a.cardInstanceId === huornId)).toBe(true);
  });

  test('path crosses a Dark-domain (two regions): the card is inert', () => {
    const base = orgState([LEGOLAS], [HUORN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const atDarkPath = { ...base, phaseState: mhAt([RegionType.Wilderness, RegionType.Dark], ['Hithaeglir', 'Moria Gate']) };
    const huornId = findHandCardId(atDarkPath, HAZARD_PLAYER, HUORN);

    const constrained = addConstraint(atDarkPath, {
      source: mint(),
      sourceDefinitionId: ELF_PATH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-if-safe-path' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    expect(after.some(a => a.cardInstanceId === huornId)).toBe(true);
  });

  test('constraint clears at turn-end via sweepExpired', () => {
    const base = orgState([LEGOLAS]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const constrained = addConstraint(base, {
      source: mint(),
      sourceDefinitionId: ELF_PATH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'only-creatures-keyed-to-site-if-safe-path' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
