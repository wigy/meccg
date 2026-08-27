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

import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic } from './atomic-write.js';
import {
  Phase, computeTournamentBreakdown, isAvatarCharacter, isCharacterCard,
} from '@meccg/shared';
import type {
  Alignment, CardDefinitionId, CardInstance, GameState, MarshallingPointTotals, PlayerId,
  PlayerState,
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
  /** False when the seat was played by an AI client. */
  readonly human: boolean;
  readonly alignment: Alignment;
  /**
   * The player's avatar by name — a Wizard, a Ringwraith, a fallen Istar, or
   * the Balrog, depending on alignment. Null only when the deck holds no
   * avatar at all.
   */
  readonly avatar: string | null;
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
  readonly winReason: 'marshalling-points' | 'one-ring' | 'concession';
  /** The winning ring card on a one-ring win, null otherwise. */
  readonly winCard: CardDefinitionId | null;
  readonly winAlignment: Alignment | null;
  readonly players: readonly [CompletedGamePlayer, CompletedGamePlayer];
}

const NO_DECK: PlayerDeckInfo = { id: null, name: null, gameLength: null };

/**
 * The name of a player's avatar. `PlayerState.wizard` is never assigned by the
 * engine (avatars are ordinary characters, not a declared selection), so the
 * avatar is recovered from the cards themselves: an avatar is the only
 * character with no mind cost ({@link isAvatarCharacter}).
 *
 * The avatar in play is preferred, but a game can end with it eliminated or
 * still in the deck, so every zone the player's cards can rest in is searched.
 * A deck carries three copies of its avatar, so this only comes back null for
 * a deck built without one. Candidates are restricted to the player's own
 * alignment: a deck may hold an opposing avatar as a hazard creature (a Nazgûl
 * played against a hero company), and that is not the player's avatar.
 */
function avatarName(state: GameState, player: PlayerState): string | null {
  const inPlay = Object.values(player.characters).map(c => c.definitionId);
  const elsewhere: readonly (readonly CardInstance[])[] = [
    player.hand, player.discardPile, player.outOfPlayPile, player.playDeck,
    player.sideboard, player.killPile,
  ];
  const candidates = [...inPlay, ...elsewhere.flatMap(zone => zone.map(c => c.definitionId))];

  for (const definitionId of candidates) {
    const def = state.cardPool[definitionId];
    if (!isCharacterCard(def) || !isAvatarCharacter(def)) continue;
    if (def.alignment === player.alignment) return def.name;
  }
  return null;
}

/**
 * Build the record from a game-over state. Pure; throws if the game is not
 * over. `deckInfo` is keyed by lowercase player name and `aiPlayers` holds
 * lowercase names of AI-controlled seats (both facts only exist in the
 * join messages, not on `GameState`).
 */
export function buildCompletedGameRecord(
  state: GameState,
  deckInfo: Readonly<Record<string, PlayerDeckInfo>>,
  aiPlayers: ReadonlySet<string>,
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
      human: !aiPlayers.has(player.name.toLowerCase()),
      alignment: player.alignment,
      avatar: avatarName(state, player),
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
  const filePath = path.join(GAME_RECORDS_DIR, `${record.gameId}.json`);
  writeFileAtomic(filePath, JSON.stringify(record, null, 2) + '\n');
  return filePath;
}
