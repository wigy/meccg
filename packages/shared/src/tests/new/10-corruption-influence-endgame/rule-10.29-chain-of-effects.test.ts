/**
 * @module rule-10.29-chain-of-effects
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.29: Chain of Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When a player declares that they are taking an action, their opponent may declare that they are taking another action in response, prior to resolving any of those actions' effects; this sequence of unresolved declarations is called a chain of effects. When a chain of effects is initiated by a new action being declared, the player who didn't initiate the chain of effects may respond by declaring their own action, and so forth with alternating opportunities to declare additional responses. Once both players confirm that they have no more actions to take in response, the current chain of effects resolves in the reverse order of declaration (i.e. last in, first out). Players cannot take further actions while a chain of effects is resolving, and cannot take actions that would initiate a new chain of effects until a current chain of effects has completely resolved.
 * The resource player always has priority to initiate a new chain of effects.
 * Performing an action as an active condition does not initiate a separate chain of effects.
 * If a rule or effect happens "immediately," it resolves without initiating a chain of effects and without either player being allowed to respond.
 */

import { describe, test } from 'vitest';

describe('Rule 10.29 — Chain of Effects', () => {
  test.todo('Actions declared in response form chain; resolves last-in first-out; no actions while resolving; resource player has priority');
});
