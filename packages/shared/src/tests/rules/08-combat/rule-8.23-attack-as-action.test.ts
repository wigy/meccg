/**
 * @module rule-8.23-attack-as-action
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.23: Attack as Action
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An attack involves dice-rolling and many other actions when it resolves into combat, so initiating an attack is considered its own action and the declaration of an attack due to a passive condition will thus initiate a new chain of effects.
 * An action that would potentially initiate combat during its resolution must initiate a chain of effects, meaning that it cannot be taken in response (except for on-guard cards). Such an action also cannot be taken during combat.
 * Once an attack resolves into combat in a chain of effects, it can no longer be canceled by the card that created the attack leaving play.
 */

import { describe, test } from 'vitest';

// Attack initiation already routes through `initiateChain`/`initiateOrPushChain`
// (chain-reducer.ts) rather than resolving inline, and `computeLegalActions`
// delegates entirely to combat-specific actions whenever `state.combat` is
// active (legal-actions/index.ts), so an attack-initiating action is
// structurally unavailable "during combat" or as a response to another
// chain entry. What's unverified in isolation is the narrower claim that
// once an attack has resolved into combat, the specific card that created it
// (e.g. a `trigger-attack-on-play` permanent event like Rescue Prisoners)
// leaving play no longer retroactively cancels that already-active combat —
// no test constructs "the creating card leaves play mid-combat" as a
// distinct scenario from the ordinary combat-finalize path.
describe('Rule 8.23 — Attack as Action', () => {
  test.todo('Initiating attack is its own action; must initiate chain of effects; cannot be taken during combat or in response');
});
