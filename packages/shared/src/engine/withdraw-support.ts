/**
 * @module withdraw-support
 *
 * Taking back a support tap before the roll it was meant for.
 *
 * Tapping a character, ally or item to support a strike or a corruption check
 * (`support-strike`, `support-corruption-check`) is otherwise final. To fix
 * misclicks and allow a change of mind, every support tap is recorded in
 * `GameState.withdrawableSupport`, and the supporting player may undo it with
 * a `withdraw-support` action — untapping the supporter and removing its
 * bonus — until anything else happens. {@link updateWithdrawableSupport},
 * called once from `reduce`, appends an entry after each support tap and
 * clears the list after every other action, so a player can never use the
 * withdrawal to react to information revealed after the support was given.
 *
 * `withdraw-support` is a human-only meta-action (see `isMetaAction`): it is
 * layered onto a human seat's actions by `withMetaActions` and is never part
 * of `computeLegalActions`, so AI agents, auto-pass and the sim never pick it
 * (and can never loop support → withdraw → support).
 */

import type { GameState, GameAction, PlayerId, WithdrawableSupport, EvaluatedAction } from '../index.js';
import { CardStatus } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { resolveInstanceId } from '../types/state.js';
import { getPlayerIndex } from '../state-utils.js';
import { logDetail } from './legal-actions/log.js';
import { updatePlayer, updateCharacter, updateAttachment, cardName } from './reducer-utils.js';
import type { ReducerResult } from './reducer-utils.js';
import { removeConstraint } from './pending.js';

/** Action types that keep the withdrawal window open (see {@link updateWithdrawableSupport}). */
const SUPPORT_WINDOW_ACTION_TYPES: ReadonlySet<string> = new Set([
  'support-strike',
  'support-corruption-check',
  'withdraw-support',
]);

/**
 * Maintains `GameState.withdrawableSupport` after `action` was successfully
 * applied, turning `prev` into `next`:
 *
 * - a support tap appends an entry describing how its bonus was banked;
 * - `withdraw-support` leaves the list as its handler left it;
 * - any other action closes the window by clearing the list.
 */
export function updateWithdrawableSupport(prev: GameState, next: GameState, action: GameAction): GameState {
  if (!SUPPORT_WINDOW_ACTION_TYPES.has(action.type)) {
    return (next.withdrawableSupport?.length ?? 0) > 0 ? { ...next, withdrawableSupport: [] } : next;
  }
  const entry = describeSupport(prev, next, action);
  if (!entry) return next;
  logDetail(`Support by ${entry.source as string} (${entry.kind}) may be withdrawn until the next other action`);
  return { ...next, withdrawableSupport: [...(next.withdrawableSupport ?? []), entry] };
}

/**
 * Works out how a just-applied support tap banked its bonus by comparing the
 * states before and after it: a fresh corruption `check-modifier` constraint
 * sourced from the supporter (pending checks, item boosts), the Free Council
 * `pendingCheck.supportCount`, or the current strike's `supportCount`.
 */
function describeSupport(prev: GameState, next: GameState, action: GameAction): WithdrawableSupport | null {
  if (action.type === 'support-strike') {
    if (!prev.combat) return null;
    return { kind: 'strike', player: action.player, source: action.supportingCharacterId, strikeIndex: prev.combat.currentStrikeIndex };
  }
  if (action.type !== 'support-corruption-check') return null;
  const source = action.supportingItemInstanceId ?? action.supportingCharacterId;
  if (source === undefined) return null;
  const prevIds = new Set(prev.activeConstraints.map(c => c.id));
  const constraint = next.activeConstraints.find(c =>
    !prevIds.has(c.id) && c.source === source && c.kind.type === 'check-modifier');
  if (constraint) return { kind: 'check-modifier', player: action.player, source, constraintId: constraint.id };
  if (next.phaseState.phase === Phase.FreeCouncil && next.phaseState.pendingCheck) {
    return { kind: 'fc-check', player: action.player, source };
  }
  return null;
}

/**
 * Applies a `withdraw-support` action: untaps the supporter recorded in
 * `GameState.withdrawableSupport` and reverses the bonus it added.
 */
export function handleWithdrawSupport(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'withdraw-support') return { state, error: 'Expected withdraw-support' };
  const entries = state.withdrawableSupport ?? [];
  const entry = entries.find(e => e.source === action.supportSourceId && e.player === action.player);
  if (!entry) return { state, error: 'withdraw-support: no withdrawable support from that card' };

  const untapped = untapSupporter(state, action.player, entry.source);
  if ('error' in untapped) return { state, error: untapped.error };
  let next = untapped.state;

  switch (entry.kind) {
    case 'strike': {
      const assignment = next.combat?.strikeAssignments[entry.strikeIndex];
      if (!next.combat || !assignment || assignment.resolved || (assignment.supportCount ?? 0) <= 0) {
        return { state, error: 'withdraw-support: the supported strike is no longer pending' };
      }
      const strikeAssignments = next.combat.strikeAssignments.map((a, i) =>
        i === entry.strikeIndex ? { ...a, supportCount: (a.supportCount ?? 0) - 1 } : a);
      next = { ...next, combat: { ...next.combat, strikeAssignments } };
      break;
    }
    case 'fc-check': {
      const ps = next.phaseState;
      if (ps.phase !== Phase.FreeCouncil || !ps.pendingCheck || ps.pendingCheck.supportCount <= 0) {
        return { state, error: 'withdraw-support: the supported corruption check is no longer pending' };
      }
      next = { ...next, phaseState: { ...ps, pendingCheck: { ...ps.pendingCheck, supportCount: ps.pendingCheck.supportCount - 1 } } };
      break;
    }
    case 'check-modifier': {
      if (!next.activeConstraints.some(c => c.id === entry.constraintId)) {
        return { state, error: 'withdraw-support: the support bonus is no longer pending' };
      }
      next = removeConstraint(next, entry.constraintId);
      break;
    }
  }

  const defId = resolveInstanceId(state, entry.source);
  logDetail(`${defId ? cardName(state, defId) : entry.source as string} withdraws its support (${entry.kind}) and untaps`);
  return { state: { ...next, withdrawableSupport: entries.filter(e => e !== entry) } };
}

/**
 * Untaps the supporting card — a character, or an ally or item borne by one
 * of `playerId`'s characters. Supporters are always untapped before they tap
 * to support, so untapping restores their original status exactly.
 */
function untapSupporter(state: GameState, playerId: PlayerId, sourceId: WithdrawableSupport['source']): { state: GameState } | { error: string } {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const character = player.characters[sourceId];
  if (character) {
    if (character.status !== CardStatus.Tapped) return { error: 'withdraw-support: supporter is not tapped' };
    return { state: updatePlayer(state, playerIndex, p => updateCharacter(p, sourceId, c => ({ ...c, status: CardStatus.Untapped }))) };
  }
  for (const kind of ['allies', 'items'] as const) {
    let wasTapped = false;
    const updated = kind === 'allies'
      ? updateAttachment(player, kind, sourceId, a => { wasTapped = a.status === CardStatus.Tapped; return { ...a, status: CardStatus.Untapped }; })
      : updateAttachment(player, kind, sourceId, a => { wasTapped = a.status === CardStatus.Tapped; return { ...a, status: CardStatus.Untapped }; });
    if (!updated) continue;
    if (!wasTapped) return { error: 'withdraw-support: supporter is not tapped' };
    return { state: updatePlayer(state, playerIndex, () => updated.player) };
  }
  return { error: 'withdraw-support: supporter not found' };
}

/** One `withdraw-support` action per support `playerId` may still take back. */
export function withdrawSupportActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  return (state.withdrawableSupport ?? [])
    .filter(e => e.player === playerId)
    .map(e => ({ action: { type: 'withdraw-support', player: playerId, supportSourceId: e.source }, viable: true }));
}
