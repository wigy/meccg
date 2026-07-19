/**
 * @module rule-10.18-resource-hazard-action-types
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.18: Resource/Character vs Hazard Action Types
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A "resource/character action" is an action that involves either playing a resource or character card, taking an action as allowed by such a card, or tapping/discarding such a card for an effect per the game rules; resource/character actions can only be taken when a resource short-event could be played (unless the card states otherwise). A "hazard action" includes either playing a hazard card, taking an action as allowed by such a card, or tapping/discarding such a card for an effect per the game rules; hazard actions on cards in play can only be taken when a hazard short-event could be played (unless the card states otherwise).
 */

import { describe, test } from 'vitest';

// Definitional rule: it names the vocabulary ("resource/character action",
// "hazard action") this codebase already uses throughout its own phase
// handlers (legal-actions/organization.ts, movement-hazard.ts, site.ts split
// resource-player and hazard-player action generation exactly along this
// line), and every single-card test in the suite exercises one or the
// other. There's no separate scenario that isolates "is this classified as
// a resource action or a hazard action" as its own observable behavior.
describe('Rule 10.18 — Resource/Character vs Hazard Action Types', () => {
  test.todo('Resource/character actions: play resource/character, use such cards, tap/discard for effect; hazard actions similar; timing rules');
});
