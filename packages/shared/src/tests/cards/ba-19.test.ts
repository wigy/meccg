/**
 * @module ba-19.test
 *
 * Card test: Glance of Arien (ba-19)
 * Type: hazard-event (short), keyword "environment", non-unique.
 *
 * Text:
 *   "Environment. Playable on The Balrog at or moving to a non-Under-deeps
 *    site. -2/-1 to his prowess/body until the end of the turn. This
 *    modification is -4/-2 if Gates of Morning is in play. Cannot be
 *    duplicated on a given turn."
 *
 * Card shape (effects):
 *   - play-target character, filter { target.name: "The Balrog" }
 *   - play-condition requires: site-not-under-deeps
 *   - stat-modifier prowess -2 (always)
 *   - stat-modifier prowess -2 when Gates of Morning in play (net -4)
 *   - stat-modifier body -1 (always)
 *   - stat-modifier body -1 when Gates of Morning in play (net -2)
 *   - duplication-limit scope turn, max 1
 *
 * Engine support:
 *   - Character-targeting hazard short-event: offered per matching character in
 *     the active (moving) company (play-target filter restricts to The Balrog).
 *   - play-condition `site-not-under-deeps`: gates on the target company's
 *     effective site (destination if moving, else current) not carrying the
 *     `under-deeps` keyword.
 *   - On chain resolution the card's stat-modifier effects become turn-scoped
 *     `character-stat-modifier` constraints on the target character; each
 *     effect's `when` is evaluated against the in-play card names so the Gates
 *     of Morning clause strengthens the penalty. The value is locked at
 *     resolution time and flows through the normal effective-stats pipeline.
 *   - duplication-limit scope turn: a resolved copy leaves active constraints
 *     that block a second copy the same turn.
 *
 * Rule coverage:
 * | # | Rule                                                            | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Playable on The Balrog at a non-Under-deeps site                | IMPLEMENTED |
 * | 2 | NOT playable when the site is an Under-deeps site               | IMPLEMENTED |
 * | 3 | Playable when moving to a non-Under-deeps site (dest branch)    | IMPLEMENTED |
 * | 4 | NOT playable when moving to an Under-deeps site (dest branch)   | IMPLEMENTED |
 * | 5 | Only The Balrog is a legal target (company-mates excluded)      | IMPLEMENTED |
 * | 6 | -2/-1 prowess/body applied until end of turn                    | IMPLEMENTED |
 * | 7 | -4/-2 while Gates of Morning is in play                         | IMPLEMENTED |
 * | 8 | Applied as turn-scoped character-stat-modifier constraints      | IMPLEMENTED |
 * | 9 | Cannot be duplicated on a given turn                            | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, addCardInPlay,
  viableActions, resolveChain, dispatch, findCharInstanceId, getCharacter,
  MORIA, LORIEN, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHazardAction } from '../../index.js';
import { Alignment, RegionType } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const GLANCE_OF_ARIEN = 'ba-19' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;        // balrog avatar, prowess 8 / body 11
const LUITPRAND = 'le-23' as CardDefinitionId;        // minion man company-mate
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;  // Under-deeps site
const GATES_OF_MORNING = 'tw-243' as CardDefinitionId; // hero environment

/** Filter play-hazard actions to those targeting a specific character. */
const targetingChar = (actions: ReturnType<typeof viableActions>, charId: CardInstanceId) =>
  actions.filter(a => (a.action as PlayHazardAction).targetCharacterId === charId);

describe('Glance of Arien (ba-19)', () => {
  beforeEach(() => resetMint());

  // ─── Playability keying ─────────────────────────────────────────────────────

  test('playable on The Balrog at a non-Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    expect(offers).toHaveLength(1);
  });

  test('NOT playable when The Balrog is at an Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    expect(offers).toHaveLength(0);
  });

  test('playable when moving to a non-Under-deeps site (from an Under-deeps site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [THE_BALROG], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    expect(offers).toHaveLength(1);
  });

  test('NOT playable when moving to an Under-deeps site (from a non-Under-deeps site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG], destinationSite: UNDER_GALLERIES }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    expect(offers).toHaveLength(0);
  });

  test('only The Balrog is a legal target — a company-mate is not offered', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG, LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const luitId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);
    const offers = viableActions(state, PLAYER_2, 'play-hazard');
    expect(targetingChar(offers, balrogId)).toHaveLength(1);
    expect(targetingChar(offers, luitId)).toHaveLength(0);
  });

  // ─── Effect: prowess/body penalty until end of turn ──────────────────────────

  test('applies -2 prowess / -1 body to The Balrog until end of turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    // Baseline: prowess 8 / body 11.
    expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(8);
    expect(getCharacter(state, RESOURCE_PLAYER, THE_BALROG).effectiveStats.body).toBe(11);

    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    const after = resolveChain(dispatch(state, offers[0].action));

    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(6);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).effectiveStats.body).toBe(10);
  });

  test('penalty is -4/-2 while Gates of Morning is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Gates of Morning in play (owned by the hazard player).
    const withGates = addCardInPlay(base, HAZARD_PLAYER, GATES_OF_MORNING);
    const state: GameState = { ...withGates, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    const after = resolveChain(dispatch(state, offers[0].action));

    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).effectiveStats.prowess).toBe(4);  // 8 - 4
    expect(getCharacter(after, RESOURCE_PLAYER, THE_BALROG).effectiveStats.body).toBe(9);      // 11 - 2
  });

  test('applies the penalty as turn-scoped character-stat-modifier constraints on The Balrog', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    const offers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    const after = resolveChain(dispatch(state, offers[0].action));

    const turnMods = after.activeConstraints.filter(
      c => c.scope.kind === 'turn' && c.kind.type === 'character-stat-modifier'
        && c.kind.characterId === balrogId,
    );
    // One for prowess (-2), one for body (-1).
    expect(turnMods).toHaveLength(2);
    const prowessMod = turnMods.find(c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess');
    const bodyMod = turnMods.find(c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'body');
    expect(prowessMod && prowessMod.kind.type === 'character-stat-modifier' && prowessMod.kind.value).toBe(-2);
    expect(bodyMod && bodyMod.kind.type === 'character-stat-modifier' && bodyMod.kind.value).toBe(-1);
  });

  // ─── Duplication ─────────────────────────────────────────────────────────────

  test('cannot be duplicated on a given turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [GLANCE_OF_ARIEN, GLANCE_OF_ARIEN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    // Play the first copy and resolve it — leaves the turn-scoped constraints.
    const firstOffers = targetingChar(viableActions(state, PLAYER_2, 'play-hazard'), balrogId);
    expect(firstOffers).toHaveLength(1);
    const after = resolveChain(dispatch(state, firstOffers[0].action));

    // The second copy is no longer viable this turn.
    const secondOffers = computeLegalActions(after, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action as PlayHazardAction).targetCharacterId === balrogId);
    expect(secondOffers).toHaveLength(0);
  });
});
