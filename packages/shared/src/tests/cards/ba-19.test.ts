/**
 * @module ba-19.test
 *
 * Card test: Glance of Arien (ba-19)
 * Type: hazard-event (short), keyword "environment", alignment: neutral
 *
 * Text:
 *   "Environment. Playable on The Balrog at or moving to a non-Under-deeps
 *    site. -2/-1 to his prowess/body until the end of the turn. This
 *    modification is -4/-2 if Gates of Morning is in play. Cannot be
 *    duplicated on a given turn."
 *
 * Modeling (see step-2/step-7 report):
 *  - `play-target` `target: "character"`, filter `{ target.name: "The Balrog" }`
 *    — only offered on The Balrog.
 *  - `play-condition` `requires: "company-site"` with a generic DSL condition
 *    evaluated against the active company's relevant site (its destination when
 *    moving, else its current site). Glance uses
 *    `{ "$not": { "site.keywords": { "$includes": "under-deeps" } } }` for
 *    "at or moving to a non-Under-deeps site".
 *  - two base `on-event: self-enters-play` → `add-constraint`
 *    `character-stat-modifier` effects (prowess -2, body -1, scope turn) that
 *    target the chosen character on chain resolution, plus two more gated
 *    `when: { inPlay: "Gates of Morning" }` (an extra prowess -2 / body -1, for
 *    a total of -4/-2 while Gates of Morning is out).
 *  - `duplication-limit` `scope: "turn"` — one Glance of Arien per turn.
 *
 * The Balrog (ba-3): base prowess 8, body 11 → 6/10 normally, 4/9 with Gates
 * of Morning in play.
 *
 * Every test drives the reducer / legal-action computation — no assertion
 * reads a card-JSON field back against itself.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, addCardInPlay, mint,
  resolveChain, dispatch, viableActions, findCharInstanceId,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import { Alignment, RegionType, CardStatus } from '../../index.js';

const GLANCE_OF_ARIEN = 'ba-19' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;        // name "The Balrog", prowess 8, body 11
const LUITPRAND = 'le-23' as CardDefinitionId;         // non-Balrog man
const GATES_OF_MORNING = 'tw-243' as CardDefinitionId;
const UNDER_GALLERIES = 'as-164' as CardDefinitionId;  // under-deeps dark-hold

/**
 * Build a minion M/H play-hazards state: PLAYER_1 (active, the Balrog player)
 * has a company with `chars` at `originSite`; PLAYER_2 (hazard) holds
 * `handCopies` copies of Glance of Arien. When `destinationSite` is given the
 * company has declared movement to that freshly-minted site.
 */
function buildBalrogMH(chars: CardDefinitionId[], opts?: {
  originSite?: CardDefinitionId;
  destinationSite?: CardDefinitionId;
  handCopies?: number;
}): GameState {
  const originSite = opts?.originSite ?? MORIA;
  const hand = Array.from({ length: opts?.handCopies ?? 1 }, () => GLANCE_OF_ARIEN);
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: originSite, characters: chars }],
        hand: [], siteDeck: [originSite],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }],
        hand, siteDeck: [RIVENDELL],
      },
    ],
  });
  const mh = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness] });
  let players = base.players;
  if (opts?.destinationSite) {
    const dest = { instanceId: mint(), definitionId: opts.destinationSite, status: CardStatus.Untapped };
    players = [
      {
        ...base.players[0],
        companies: [{ ...base.players[0].companies[0], siteCardOwned: true, destinationSite: dest }],
      },
      base.players[1],
    ] as unknown as typeof base.players;
  }
  return { ...base, phaseState: mh, players };
}

describe('Glance of Arien (ba-19)', () => {
  beforeEach(() => resetMint());

  // ─── Playability ────────────────────────────────────────────────────────────

  test('offered on The Balrog while at a non-Under-deeps site', () => {
    const state = buildBalrogMH([THE_BALROG]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBe(balrogId);
  });

  test('offered when The Balrog is moving to a non-Under-deeps site', () => {
    const state = buildBalrogMH([THE_BALROG], { destinationSite: MINAS_TIRITH });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('NOT offered when The Balrog is moving to an Under-deeps site', () => {
    const state = buildBalrogMH([THE_BALROG], { destinationSite: UNDER_GALLERIES });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('only The Balrog is a legal target (filter excludes a non-Balrog company-mate)', () => {
    const state = buildBalrogMH([THE_BALROG, LUITPRAND]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBe(balrogId);
  });

  test('NOT offered when the company contains no character named The Balrog', () => {
    const state = buildBalrogMH([LUITPRAND]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Effect ──────────────────────────────────────────────────────────────────

  test('applies -2 prowess / -1 body to The Balrog until end of turn', () => {
    const state = buildBalrogMH([THE_BALROG]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    // Sanity: base stats before the hazard.
    expect(state.players[RESOURCE_PLAYER].characters[balrogId].effectiveStats.prowess).toBe(8);
    expect(state.players[RESOURCE_PLAYER].characters[balrogId].effectiveStats.body).toBe(11);

    const action = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const resolved = resolveChain(dispatch(state, action));

    const balrog = resolved.players[RESOURCE_PLAYER].characters[balrogId];
    expect(balrog.effectiveStats.prowess).toBe(6);
    expect(balrog.effectiveStats.body).toBe(10);
  });

  test('modification is -4 prowess / -2 body while Gates of Morning is in play', () => {
    let state = buildBalrogMH([THE_BALROG]);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    const action = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const resolved = resolveChain(dispatch(state, action));

    const balrog = resolved.players[RESOURCE_PLAYER].characters[balrogId];
    expect(balrog.effectiveStats.prowess).toBe(4);
    expect(balrog.effectiveStats.body).toBe(9);
  });

  // ─── Duplication ─────────────────────────────────────────────────────────────

  test('cannot be duplicated on a given turn', () => {
    const state = buildBalrogMH([THE_BALROG], { handCopies: 2 });
    // Play the first copy and resolve — its turn-scoped constraint persists.
    const firstAction = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const afterFirst = resolveChain(dispatch(state, firstAction));

    // The second copy is still in hand but no longer viable this turn.
    expect(viableActions(afterFirst, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
