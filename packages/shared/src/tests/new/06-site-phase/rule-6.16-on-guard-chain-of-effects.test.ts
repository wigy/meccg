/**
 * @module rule-6.16-on-guard-chain-of-effects
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.16: On-Guard Chain of Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When an on-guard card is revealed in response to a resource being played, it initiates a separate chain of events that is treated as if it had been declared immediately prior to the chain of effects during which it was revealed. Once players finish responding to this on-guard-initiated chain of effects and the on-guard chain resolves (as well as any passive-condition-initiated chains of effects that would normally follow), the original chain of effects then resumes.
 * Only declared or ongoing effects may be considered when determining the validity of revealing an on-guard card. Potential effects cannot be considered (except for passive conditions that would depend on the result of a declared influence attempt).
 * Cards that are specifically playable on a character facing an attack or strike cannot be revealed on-guard because the target did not exist during the movement/hazard phase.
 * If an on-guard card is revealed that would (indirectly) tap a character that was just tapped to play a resource, the character remains tapped and the play of the resource proceeds normally.
 * On-guard cards placed on a company's site can only be revealed against, and can only affect, the same company on which the on-guard card was placed or a new company comprising that same company (unless the hazard states that it affects all versions of the site).
 * When an on-guard card is revealed, it immediately ceases to be considered an on-guard card.
 */

import { describe, test } from 'vitest';

describe('Rule 6.16 — On-Guard Chain of Effects', () => {
  test.todo('Revealed on-guard initiates separate chain treated as declared immediately prior to the triggering chain');
});
