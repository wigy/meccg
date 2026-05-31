/**
 * @module le-241.test
 *
 * Card test: That's Been Heard Before Tonight (le-241)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable during the site phase on an untapped character in a covert
 *    company at a Border-hold [{B}] or Free-hold [{F}] where Information is
 *    playable. Tap the character (but not the site). No marshalling points are
 *    received and the character may not untap until this card is stored at a
 *    Darkhaven [{DH}] during his organization phase."
 *
 * Engine Support:
 * | # | Rule                                                             | Status          | Notes                                                   |
 * |---|------------------------------------------------------------------|-----------------|---------------------------------------------------------|
 * | 1 | Playable during site phase at border-hold or free-hold            | OK              | play-target: site filter checks siteType                |
 * | 2 | Site must have Information in playableResources                   | OK              | play-target: site filter checks playableResources       |
 * | 3 | Target must be in a COVERT company                               | NOT IMPLEMENTED | No company.covert in play-target character context;     |
 * |   |                                                                  |                 | covert/overt tracking not implemented for ringwraith    |
 * |   |                                                                  |                 | companies (see le-212.test for same gap)                |
 * | 4 | Target character must be untapped                                | OK              | play-target: character filter checks target.status      |
 * | 5 | Tap the character (but not the site) on play                    | NOT IMPLEMENTED | cost: { tap: character } on play-target is not applied  |
 * |   |                                                                  |                 | during resolvePermanentEvent — only handled for short   |
 * |   |                                                                  |                 | events via applyCost in reducer-events.ts               |
 * | 6 | No MPs received (MPs granted only when stored)                   | OK (data)       | marshallingPoints: 0 on card; 2 on storable-at          |
 * | 7 | Character may not untap until card is stored at Darkhaven        | NOT IMPLEMENTED | bearer-cannot-untap constraint not placed by            |
 * |   |                                                                  |                 | resolvePermanentEvent for direct character-targeting;   |
 * |   |                                                                  |                 | only placed via select-card-bearer (trigger-attack-on-  |
 * |   |                                                                  |                 | play path, used by Rescue Prisoners). applyAdd-         |
 * |   |                                                                  |                 | ConstraintFromOnEvent targets company/player, not char. |
 * | 8 | Storing at a Darkhaven during organization phase releases lock   | PARTIAL         | storable-at: haven clears bearer-cannot-untap on store, |
 * |   |                                                                  |                 | but #7 means the constraint is never placed to begin    |
 *
 * Playable: NO — NOT CERTIFIED.
 *
 * Missing engine pieces (blocking full certification):
 *
 *   - **Covert company tracking** (rule 3): No data structure records whether a
 *     ringwraith company is currently in covert or overt mode. The play-target
 *     character filter context (`{ target: {...}, company: { skills, siteType,
 *     moving } }` in `legal-actions/site.ts`) does not expose `company.covert`.
 *     Until a covert toggle is modelled on companies and threaded into the
 *     filter context, all companies (covert or overt) are treated identically.
 *
 *   - **Character tapping as permanent-event cost** (rule 5): For permanent
 *     events played via `play-permanent-event`, the chain resolves through
 *     `resolvePermanentEvent` in `chain-reducer.ts`, which attaches the card to
 *     the character's items but never calls `applyCost`. `applyCost` is only
 *     called in `reducer-events.ts` for short events. So the `cost: { tap:
 *     "character" }` on the play-target effect is never executed for permanent
 *     events and the character remains in its current status.
 *
 *   - **bearer-cannot-untap constraint placement** (rule 7): The constraint that
 *     prevents the bearer from untapping is only added by `select-card-bearer`
 *     (enqueued from `reducer-combat.ts` after a `trigger-attack-on-play`
 *     attack resolves). `resolvePermanentEvent` does not place it for direct
 *     character-targeting permanent events, and `applyAddConstraintFromOnEvent`
 *     (used by `self-enters-play` on-event effects) targets companies/players,
 *     not individual characters. Extending this would require either a new
 *     `self-enters-play` apply type that places `bearer-cannot-untap` on the
 *     targeted character, or a dedicated code path in `resolvePermanentEvent`.
 *
 * Once these three pieces are implemented, the effects array should look like:
 *
 *   [
 *     { "type": "play-target", "target": "site",
 *       "filter": { "$and": [
 *         { "siteType": { "$in": ["border-hold", "free-hold"] } },
 *         { "playableResources": { "$includes": "information" } }
 *       ] } },
 *     { "type": "play-target", "target": "character",
 *       "filter": { "$and": [
 *         { "target.status": "untapped" },
 *         { "company.covert": true }          ← needs engine support
 *       ] },
 *       "cost": { "tap": "character" } },
 *     { "type": "storable-at", "siteTypes": ["haven"], "marshallingPoints": 2 }
 *   ]
 *
 * and the test.todo entries below should be converted to real assertions.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL,
  viableActions,
  makeSitePhase,
  RESOURCE_PLAYER,
  CardStatus,
  setCharStatus,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const THATS_BEEN_HEARD = 'le-241' as CardDefinitionId;

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;       // minion orc
const THE_MOUTH = 'le-24' as CardDefinitionId;    // minion man

// Minion sites — free-holds with Information playable (positive cases)
const BAG_END = 'le-350' as CardDefinitionId;          // free-hold, info in playableResources
const THRANDUILS_HALLS = 'le-408' as CardDefinitionId; // free-hold, info in playableResources
const MINAS_TIRITH_MINION = 'le-391' as CardDefinitionId; // free-hold, info in playableResources

// Minion sites — wrong type or no Information (negative cases)
const MORIA = 'le-392' as CardDefinitionId;       // shadow-hold (wrong type)
const BEORNS_HOUSE = 'le-354' as CardDefinitionId; // free-hold but no information
const DALE = 'le-363' as CardDefinitionId;         // border-hold, no information

// Minion haven for storage
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // darkhaven

/** Build a site-phase state with the ringwraith player at the given site. */
function sitePhaseAt(site: CardDefinitionId, opts: { cardStatus?: CardStatus } = {}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [GORBAG] }],
        hand: [THATS_BEEN_HEARD],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const withPhase = { ...state, phaseState: makeSitePhase() };
  if (opts.cardStatus === CardStatus.Tapped) {
    return setCharStatus(withPhase, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
  }
  return withPhase;
}

describe("That's Been Heard Before Tonight (le-241)", () => {
  beforeEach(() => resetMint());

  // ── Site type + Information filter (IMPLEMENTED) ──────────────────────────

  test('viable at a free-hold with Information playable (Bag End)', () => {
    const state = sitePhaseAt(BAG_END);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('viable at Thranduils Halls (free-hold with Information)', () => {
    const state = sitePhaseAt(THRANDUILS_HALLS);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not viable at a shadow-hold (Moria)', () => {
    const state = sitePhaseAt(MORIA);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not viable at a free-hold without Information (Beorn\'s House)', () => {
    const state = sitePhaseAt(BEORNS_HOUSE);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not viable at a border-hold without Information (Dale)', () => {
    const state = sitePhaseAt(DALE);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Character status filter (IMPLEMENTED) ────────────────────────────────

  test('viable targeting an untapped character', () => {
    const state = sitePhaseAt(BAG_END);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not viable when the only character is tapped', () => {
    const state = sitePhaseAt(BAG_END, { cardStatus: CardStatus.Tapped });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Unimplemented rules (test.todo) ─────────────────────────────────────

  test.todo('only viable when the company is in COVERT mode (covert/overt tracking not yet implemented)');
  test.todo('not viable when the company is OVERT (covert/overt tracking not yet implemented)');
  test.todo('playing the card taps the targeted character (permanent event cost not applied in resolvePermanentEvent)');
  test.todo('playing the card does NOT tap the site');
  test.todo('the targeted character cannot untap at the next untap phase (bearer-cannot-untap constraint not placed for direct-targeting permanent events)');
  test.todo('the character can untap again once the card is stored at a Darkhaven during organization phase');
  test.todo('2 marshalling points are received when the card is stored at a Darkhaven');
  test.todo('no marshalling points are received while the card is attached (before storage)');
});
