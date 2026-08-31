/**
 * @module on-guard-modify-attack
 *
 * Pure helper shared by the combat renderer for surfacing `modify-attack`
 * actions sourced from an unrevealed on-guard card (e.g. Unabated in Malice
 * ba-26 placed on-guard during M/H, then revealed onto the site's
 * automatic-attack per CoE rule 2.V.i). Kept dependency-free (types only) so
 * it is unit-testable without pulling in the browser render graph.
 */

import type { Company, ModifyAttackAction, OpponentCompanyView } from '@meccg/shared';

/**
 * Filter `modify-attack` legal actions down to those sourced from an
 * unrevealed on-guard card on `company` — as opposed to an in-play item or
 * ally attached to a character, which already has its own click target (the
 * item/ally image, via `modifyAttackMap` in `renderDefenderRow`). An
 * on-guard card has no character to click on, so these need the dedicated
 * on-guard modify-attack panel.
 */
export function onGuardModifyAttackActions(
  company: Company | OpponentCompanyView | undefined,
  modifyAttackActions: readonly ModifyAttackAction[],
): ModifyAttackAction[] {
  const onGuardCandidateIds = new Set(
    (company?.onGuardCards ?? [])
      // `OpponentCompanyView.onGuardCards` is typed as bare `ViewCard`
      // (no `revealed` field) — only revealed cards carry that extra
      // property at runtime (see buildOpponentView in projection.ts) — so
      // an absent field means unrevealed, same convention as company-site.ts.
      .filter(og => !('revealed' in og) || !og.revealed)
      .map(og => og.instanceId as string),
  );
  return modifyAttackActions.filter(a => onGuardCandidateIds.has(a.cardInstanceId as string));
}
