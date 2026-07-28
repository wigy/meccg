/**
 * @module game-record
 *
 * Completed-game statistics: one JSON file per finished game, written the
 * moment the state enters the game-over phase. Unlike the per-player
 * history in `~/.meccg/players/<name>/games.json` (written only when that
 * player clicks through to `finished`, so a closed tab loses the entry),
 * this record is written exactly once per game, holds both players'
 * complete scoring breakdown, and is keyed by the engine `gameId` — the
 * same id that names the replay log `~/.meccg/logs/games/<gameId>.jsonl`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Phase, computeTournamentBreakdown } from '@meccg/shared';
import type {
  Alignment, CardDefinitionId, GameState, MarshallingPointTotals, PlayerId, WizardName,
} from '@meccg/shared';

/** Where completed-game records are stored, one `<gameId>.json` each. */
export const GAME_RECORDS_DIR =
  process.env.GAME_RECORDS_DIR ?? path.join(os.homedir(), '.meccg', 'games');

/** Deck identity captured from a player's join message. */
export interface PlayerDeckInfo {
  readonly id: string | null;
  readonly name: string | null;
  readonly gameLength: string | null;
}

/** One player's slice of a completed-game record. */
export interface CompletedGamePlayer {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly alignment: Alignment;
  readonly wizard: WizardName | null;
  readonly deck: PlayerDeckInfo;
  readonly startingPlayer: boolean;
  /** Tournament-adjusted final score the winner was decided on. */
  readonly finalScore: number;
  /** Raw marshalling points by category, as accumulated in play. */
  readonly mp: MarshallingPointTotals;
  /** After CoE §10.3 doubling and diversity capping against the opponent. */
  readonly tournamentMp: MarshallingPointTotals;
  /** Fallen-wizard stage points (MEWH); 0 for other alignments. */
  readonly stagePoints: number;
}

/** Everything worth keeping about one finished game. */
export interface CompletedGameRecord {
  readonly gameId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly turns: number;
  readonly stateSeq: number;
  readonly seed: number;
  readonly winner: string | null;
  readonly winnerPlayerId: PlayerId | null;
  /** How the game was decided (CoE 10.39). */
  readonly winReason: 'marshalling-points' | 'one-ring';
  /** The winning ring card on a one-ring win, null otherwise. */
  readonly winCard: CardDefinitionId | null;
  readonly winAlignment: Alignment | null;
  readonly players: readonly [CompletedGamePlayer, CompletedGamePlayer];
}

const NO_DECK: PlayerDeckInfo = { id: null, name: null, gameLength: null };

/**
 * Build the record from a game-over state. Pure; throws if the game is not
 * over. `deckInfo` is keyed by lowercase player name (deck identity only
 * exists in the join messages, not on `GameState`).
 */
export function buildCompletedGameRecord(
  state: GameState,
  deckInfo: Readonly<Record<string, PlayerDeckInfo>>,
  endedAt: Date,
): CompletedGameRecord {
  const phaseState = state.phaseState;
  if (phaseState.phase !== Phase.GameOver) {
    throw new Error(`buildCompletedGameRecord: game is not over (phase ${phaseState.phase})`);
  }

  // The gameId prefix is the creation timestamp in base 36.
  const startedMs = parseInt(state.gameId.split('-')[0], 36);
  const startedAt = new Date(startedMs);

  const players = state.players.map((player, index) => {
    const opponent = state.players[1 - index];
    return {
      playerId: player.id,
      name: player.name,
      alignment: player.alignment,
      wizard: player.wizard,
      deck: deckInfo[player.name.toLowerCase()] ?? NO_DECK,
      startingPlayer: state.startingPlayer === player.id,
      finalScore: phaseState.finalScores[player.id],
      mp: player.marshallingPoints,
      tournamentMp: computeTournamentBreakdown(player.marshallingPoints, opponent.marshallingPoints),
      stagePoints: player.stagePoints,
    };
  }) as [CompletedGamePlayer, CompletedGamePlayer];

  const winner = phaseState.winner === null
    ? null
    : state.players.find(p => p.id === phaseState.winner) ?? null;

  return {
    gameId: state.gameId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedMs) / 1000)),
    turns: state.turnNumber,
    stateSeq: state.stateSeq,
    seed: state.rng.seed,
    winner: winner?.name ?? null,
    winnerPlayerId: winner?.id ?? null,
    winReason: phaseState.winReason.kind,
    winCard: phaseState.winReason.kind === 'one-ring' ? phaseState.winReason.card : null,
    winAlignment: phaseState.winReason.kind === 'one-ring' ? phaseState.winReason.alignment : null,
    players,
  };
}

/**
 * Write the record to `GAME_RECORDS_DIR/<gameId>.json`, overwriting any
 * previous version (re-reaching game over after an undo rewrites the same
 * file). Returns the path written.
 */
export function writeCompletedGameRecord(record: CompletedGameRecord): string {
  fs.mkdirSync(GAME_RECORDS_DIR, { recursive: true });
  const filePath = path.join(GAME_RECORDS_DIR, `${record.gameId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  return filePath;
}
