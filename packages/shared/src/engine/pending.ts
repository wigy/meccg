/**
 * @module engine/pending
 *
 * Owner of the {@link PendingResolution} queue and the
 * {@link ActiveConstraint} list at the top of {@link GameState}.
 *
 * Reducers and on-event triggers must go through this module — nothing
 * else may touch `state.pendingResolutions` or `state.activeConstraints`
 * directly. The helpers here are pure: they take a state and return a new
 * one (or read-only data derived from it).
 *
 * See `specs/2026-04-08-pending-effects-plan.md` for the rationale and design.
 */

import type {
  GameState,
  PlayerId,
  CompanyId,
  CardInstanceId,
  CardDefinitionId,
  PendingResolution,
  ResolutionId,
  ActiveConstraint,
  ConstraintId,
  ConstraintScope,
  ScopeBoundary,
} from '../index.js';

// ---- ID minting ----

/**
 * Mint a fresh, globally-unique resolution ID. Uses a simple counter
 * embedded in the prefix; collisions across saves are not a concern
 * because resolution IDs are not persisted across reloads.
 */
function mintResolutionId(state: GameState): ResolutionId {
  const n = state.pendingResolutions.length + state.stateSeq;
  return `r-${n}-${Date.now().toString(36)}` as ResolutionId;
}

/** Mint a fresh, globally-unique constraint ID. */
function mintConstraintId(state: GameState): ConstraintId {
  const n = state.activeConstraints.length + state.stateSeq;
  return `c-${n}-${Date.now().toString(36)}` as ConstraintId;
}

// ---- Pending resolution helpers ----

/**
 * Append a new pending resolution to the queue. The id is minted by the
 * helper; callers pass everything else.
 */
export function enqueueResolution(
  state: GameState,
  r: Omit<PendingResolution, 'id'>,
): GameState {
  const id = mintResolutionId(state);
  const entry: PendingResolution = { ...r, id };
  return {
    ...state,
    pendingResolutions: [...state.pendingResolutions, entry],
  };
}

/**
 * Convenience wrapper around {@link enqueueResolution} for the most common
 * case: enqueuing a `corruption-check` kind. Fills in `possessions: []`,
 * `modifier: 0`, and `transferredItemId: null` by default, which matches
 * how most callers use it.
 *
 * Keep the callsite terse: pass only the fields that actually vary.
 */
export function enqueueCorruptionCheck(
  state: GameState,
  opts: {
    readonly source: PendingResolution['source'];
    readonly actor: PlayerId;
    readonly scope: PendingResolution['scope'];
    readonly characterId: CardInstanceId;
    readonly reason: string;
    readonly modifier?: number;
    readonly possessions?: readonly CardInstanceId[];
    readonly transferredItemId?: CardInstanceId | null;
    readonly failureMode?: 'discard-ring-only' | 'discard-instead-of-eliminate';
    readonly onSuccess?: import('../types/effects.js').TriggeredAction;
    readonly awardKillMpTo?: PlayerId;
    readonly selectableOrder?: boolean;
    readonly allowSupport?: boolean;
    readonly noResourceAid?: boolean;
    readonly blockedBy?: readonly ResolutionId[];
  },
): GameState {
  return enqueueResolution(state, {
    source: opts.source,
    actor: opts.actor,
    scope: opts.scope,
    ...(opts.blockedBy ? { blockedBy: opts.blockedBy } : {}),
    kind: {
      type: 'corruption-check',
      characterId: opts.characterId,
      modifier: opts.modifier ?? 0,
      reason: opts.reason,
      possessions: opts.possessions ?? [],
      transferredItemId: opts.transferredItemId ?? null,
      failureMode: opts.failureMode,
      onSuccess: opts.onSuccess,
      awardKillMpTo: opts.awardKillMpTo,
      selectableOrder: opts.selectableOrder,
      allowSupport: opts.allowSupport,
      noResourceAid: opts.noResourceAid,
    },
  });
}

/** Remove the resolution with the given id from the queue (no-op if absent). */
export function dequeueResolution(state: GameState, id: ResolutionId): GameState {
  const next = state.pendingResolutions.filter(r => r.id !== id);
  if (next.length === state.pendingResolutions.length) return state;
  return { ...state, pendingResolutions: next };
}

/**
 * The first pending resolution waiting on the given actor, or null if
 * none. Resolutions for other actors are skipped (they will surface when
 * those actors compute legal actions). An entry whose `blockedBy` list
 * still names a queued resolution is skipped too — the actor must wait
 * until every blocking entry has drained (Ren the Unclean tw-83: "The
 * moving player makes corruption checks first").
 */
export function topResolutionFor(state: GameState, actor: PlayerId): PendingResolution | null {
  const queuedIds = new Set(state.pendingResolutions.map(r => r.id));
  for (const r of state.pendingResolutions) {
    if (r.actor !== actor) continue;
    if (r.blockedBy?.some(id => queuedIds.has(id))) continue;
    return r;
  }
  return null;
}

/** All resolutions currently queued for the given actor (FIFO order). */
export function pendingResolutionsFor(state: GameState, actor: PlayerId): readonly PendingResolution[] {
  return state.pendingResolutions.filter(r => r.actor === actor);
}

// ---- Active constraint helpers ----

/** Append a new active constraint. The id is minted by the helper. */
export function addConstraint(
  state: GameState,
  c: Omit<ActiveConstraint, 'id'>,
): GameState {
  const id = mintConstraintId(state);
  const entry: ActiveConstraint = { ...c, id };
  return {
    ...state,
    activeConstraints: [...state.activeConstraints, entry],
  };
}

/** Remove the constraint with the given id (no-op if absent). */
export function removeConstraint(state: GameState, id: ConstraintId): GameState {
  const next = state.activeConstraints.filter(c => c.id !== id);
  if (next.length === state.activeConstraints.length) return state;
  return { ...state, activeConstraints: next };
}

/** All active constraints whose target is the given company. */
export function constraintsOnCompany(
  state: GameState,
  companyId: CompanyId,
): readonly ActiveConstraint[] {
  return state.activeConstraints.filter(c => c.target.kind === 'company' && c.target.companyId === companyId);
}

/**
 * Count active constraints sourced from the given card definition. Used to
 * enforce `duplication-limit` effects: each play of the card leaves a
 * constraint behind, so the active count is how many copies are "in force".
 *
 * Pass `scopeKind` to count only constraints with a matching scope (e.g.
 * `'attack'` for attack-scoped duplication limits); omit it to count every
 * constraint from the definition regardless of scope.
 */
export function countConstraintsFromDefinition(
  state: GameState,
  definitionId: CardDefinitionId,
  scopeKind?: ConstraintScope['kind'],
): number {
  return state.activeConstraints.filter(
    c =>
      c.sourceDefinitionId === definitionId &&
      (scopeKind === undefined || c.scope.kind === scopeKind),
  ).length;
}

// ---- Sweep ----

/**
 * Drop every pending resolution and active constraint whose scope has
 * expired at the given boundary. Called by phase reducers at every
 * relevant transition.
 *
 * The matching rules are:
 *
 *  - `phase-end: P` clears resolutions whose scope is `phase: P` or
 *    `phase-step: P/*`, and constraints whose scope is `phase: P`.
 *  - `phase-step-end: P/S` clears resolutions whose scope is
 *    `phase-step: P/S`. Constraints with phase scope are unaffected.
 *  - `company-mh-end: C` clears resolutions whose scope is
 *    `company-mh-subphase: C` and constraints with `company-mh-phase: C`.
 *  - `company-site-end: C` clears resolutions whose scope is
 *    `company-site-subphase: C` and constraints with `company-site-phase: C`.
 *  - `turn-end` clears constraints whose scope is `turn`. Resolutions
 *    are not turn-scoped today, so they are unaffected.
 */
export function sweepExpired(state: GameState, boundary: ScopeBoundary): GameState {
  const keepResolution = (r: PendingResolution): boolean => {
    const s = r.scope;
    switch (boundary.kind) {
      case 'phase-end':
        if (s.kind === 'phase' && s.phase === boundary.phase) return false;
        if (s.kind === 'phase-step' && s.phase === boundary.phase) return false;
        return true;
      case 'phase-step-end':
        if (s.kind === 'phase-step' && s.phase === boundary.phase && s.step === boundary.step) return false;
        return true;
      case 'company-mh-end':
        if (s.kind === 'company-mh-subphase' && s.companyId === boundary.companyId) return false;
        return true;
      case 'company-site-end':
        if (s.kind === 'company-site-subphase' && s.companyId === boundary.companyId) return false;
        return true;
      case 'attack-end':
        return true;
      case 'organization-phase-end':
        // No ResolutionScope is keyed to the organization phase boundary.
        return true;
      case 'turn-end':
        return true;
    }
  };

  const keepConstraint = (c: ActiveConstraint): boolean => {
    const s = c.scope;
    switch (boundary.kind) {
      case 'phase-end':
        if (s.kind === 'phase' && s.phase === boundary.phase) return false;
        return true;
      case 'phase-step-end':
        return true;
      case 'company-mh-end':
        if (s.kind === 'company-mh-phase' && s.companyId === boundary.companyId) return false;
        return true;
      case 'company-site-end':
        if (s.kind === 'company-site-phase' && s.companyId === boundary.companyId) return false;
        return true;
      case 'attack-end':
        if (s.kind === 'attack') return false;
        return true;
      case 'organization-phase-end':
        // "Through your next organization phase": drop it at the owner's
        // organization-phase end, but not the one it was created in (same turn
        // number) — that is the phase the card was activated during.
        if (s.kind === 'next-organization-phase'
          && s.playerId === boundary.playerId
          && boundary.turnNumber > s.afterTurn) return false;
        return true;
      case 'turn-end':
        if (s.kind === 'turn') return false;
        return true;
    }
  };

  const newResolutions = state.pendingResolutions.filter(keepResolution);
  const newConstraints = state.activeConstraints.filter(keepConstraint);

  if (
    newResolutions.length === state.pendingResolutions.length &&
    newConstraints.length === state.activeConstraints.length
  ) {
    return state;
  }
  return {
    ...state,
    pendingResolutions: newResolutions,
    activeConstraints: newConstraints,
  };
}
