/**
 * @module wh-119.test
 *
 * Card test: Man of Skill (wh-119)
 * Type: minion-resource-event (stage permanent-event, Saruman-specific)
 *
 * Printed text:
 *   "Unique. Saruman specific. Your permanent-events that require a site where
 *    Information is playable are each worth 2 marshalling points."
 *
 * Card shape (data):
 *   - Unique, `alignment: "stage"`, `eventType: "permanent"`, MP 0 (category
 *     misc) — a stage permanent-event placed by a Fallen-wizard (Saruman).
 *   - effects:
 *     1. stage-points (2) — the card's printed stage value, summed into the
 *        controller's running stage-point total (MEWH §1).
 *     2. permanent-event-mp (value 2, requiresResource "information") — while
 *        in play, every permanent-event the player controls that "requires a
 *        site where Information is playable" (i.e. carries a play-condition
 *        `requires: 'site-has-resource', subtype: 'information'`) scores
 *        exactly 2 MP, overriding its printed value and the MEWH §4 1-MP clamp.
 *
 * A permanent-event "requires a site where Information is playable" is the same
 * prerequisite the legal-action layer reports as "requires a site where
 * Information is playable" — there is no real card carrying it yet, so these
 * tests register synthetic permanent-events in the shared pool and drive the
 * production `recomputeDerived` MP/stage-point derivation, asserting the
 * resulting `PlayerState.marshallingPoints` / `stagePoints` (never card JSON
 * against itself).
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, pool, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ISENGARD, RIVENDELL, MORIA, LORIEN, LEGOLAS,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay } from '../../index.js';

const MAN_OF_SKILL = 'wh-119' as CardDefinitionId; // the card under test
const SARUMAN_FW    = 'wh-9'   as CardDefinitionId; // Fallen-wizard avatar (Saruman)

// Synthetic permanent-events registered in the shared pool. Printed MP 3 so the
// 2-MP override is distinguishable from both the printed value (3) and the
// Fallen-wizard §4 clamp (1).
const INFO_PE      = 'test-info-pe'     as CardDefinitionId; // requires Information site
const INFO_PE_2    = 'test-info-pe-2'   as CardDefinitionId; // a second Information-site permanent-event
const GOLDRING_PE  = 'test-goldring-pe' as CardDefinitionId; // requires Gold-ring site (different subtype)
const PLAIN_PE     = 'test-plain-pe'    as CardDefinitionId; // no site-has-resource prerequisite

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

describe('Man of Skill (wh-119)', () => {
  beforeAll(() => {
    const peDef = (id: CardDefinitionId, name: string, requiresSubtype: string | null): unknown => ({
      cardType: 'minion-resource-event',
      alignment: 'minion',
      id,
      name,
      unique: false,
      eventType: 'permanent',
      marshallingPoints: 3,
      marshallingCategory: 'misc',
      effects: requiresSubtype
        ? [{ type: 'play-condition', requires: 'site-has-resource', subtype: requiresSubtype }]
        : [],
      text: `Test permanent-event${requiresSubtype ? ` requiring ${requiresSubtype}` : ''}.`,
    });
    (pool as Record<string, unknown>)[INFO_PE as string]     = peDef(INFO_PE, 'Test Info PE', 'information');
    (pool as Record<string, unknown>)[INFO_PE_2 as string]   = peDef(INFO_PE_2, 'Test Info PE Two', 'information');
    (pool as Record<string, unknown>)[GOLDRING_PE as string] = peDef(GOLDRING_PE, 'Test Gold-ring PE', 'gold-ring');
    (pool as Record<string, unknown>)[PLAIN_PE as string]    = peDef(PLAIN_PE, 'Test Plain PE', null);
  });
  afterAll(() => {
    for (const id of [INFO_PE, INFO_PE_2, GOLDRING_PE, PLAIN_PE]) {
      delete (pool as Record<string, unknown>)[id as string];
    }
  });
  beforeEach(() => resetMint());

  // Build a Fallen-wizard (Saruman) organization-phase state with `cards` in play.
  const fwWith = (cards: CardInPlay[]) =>
    buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: cards,
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

  // ─── Rule: Information-site permanent-events are each worth 2 MP ──────────

  test('an Information-site permanent-event scores 2 MP while Man of Skill is in play', () => {
    const state = fwWith([
      inPlay(MAN_OF_SKILL, 'p1-1000'),
      inPlay(INFO_PE, 'p1-1001'),
    ]);
    // Override sets the Information permanent-event to 2 (its printed 3 and the
    // §4 clamp to 1 are both overridden). Man of Skill itself contributes 0 MP.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  test('without Man of Skill, the same permanent-event is clamped to 1 MP (control)', () => {
    const state = fwWith([inPlay(INFO_PE, 'p1-1001')]);
    // MEWH §4: a non-stage card is worth a flat 1 MP to a Fallen-wizard.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('multiple Information-site permanent-events are each worth 2 MP', () => {
    const state = fwWith([
      inPlay(MAN_OF_SKILL, 'p1-1000'),
      inPlay(INFO_PE, 'p1-1001'),
      inPlay(INFO_PE_2, 'p1-1002'),
    ]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(4);
  });

  // ─── Rule: only Information-site permanent-events qualify ─────────────────

  test('a permanent-event with no site-resource prerequisite is unaffected (clamped to 1)', () => {
    const state = fwWith([
      inPlay(MAN_OF_SKILL, 'p1-1000'),
      inPlay(PLAIN_PE, 'p1-1001'),
    ]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('a permanent-event requiring a different resource (Gold-ring) is unaffected (clamped to 1)', () => {
    const state = fwWith([
      inPlay(MAN_OF_SKILL, 'p1-1000'),
      inPlay(GOLDRING_PE, 'p1-1001'),
    ]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('the override applies only to the Information permanent-event in a mixed set', () => {
    const state = fwWith([
      inPlay(MAN_OF_SKILL, 'p1-1000'),
      inPlay(INFO_PE, 'p1-1001'),     // → 2
      inPlay(GOLDRING_PE, 'p1-1002'), // → 1
      inPlay(PLAIN_PE, 'p1-1003'),    // → 1
    ]);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(4);
  });

  // ─── Card's own stage-point contribution (MEWH §1) ───────────────────────

  test('Man of Skill contributes 2 stage points to its Fallen-wizard controller', () => {
    const state = fwWith([inPlay(MAN_OF_SKILL, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    // The stage card itself is worth 0 marshalling points.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });
});
