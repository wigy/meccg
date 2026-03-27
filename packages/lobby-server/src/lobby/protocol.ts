/**
 * @module lobby/protocol
 *
 * WebSocket message types for the lobby server. The lobby WS connection
 * is separate from the game server WS — it handles player presence,
 * game challenges, and game-start signaling.
 */

// ---- Client → Lobby ----

/** Challenge an online player to a game. */
export interface ChallengeMessage {
  readonly type: 'challenge';
  readonly opponentName: string;
}

/** Accept a pending challenge. */
export interface AcceptChallengeMessage {
  readonly type: 'accept-challenge';
  readonly from: string;
}

/** Decline a pending challenge. */
export interface DeclineChallengeMessage {
  readonly type: 'decline-challenge';
  readonly from: string;
}

/** Start a game against the AI. */
export interface PlayAiMessage {
  readonly type: 'play-ai';
}

/** Union of all client → lobby messages. */
export type LobbyClientMessage =
  | ChallengeMessage
  | AcceptChallengeMessage
  | DeclineChallengeMessage
  | PlayAiMessage;

// ---- Lobby → Client ----

/** Broadcast of all currently online players. */
export interface OnlinePlayersMessage {
  readonly type: 'online-players';
  readonly players: readonly string[];
}

/** Incoming challenge from another player. */
export interface ChallengeReceivedMessage {
  readonly type: 'challenge-received';
  readonly from: string;
}

/** A challenge you sent was declined. */
export interface ChallengeDeclinedMessage {
  readonly type: 'challenge-declined';
  readonly by: string;
}

/** A game is starting — connect to the game server. */
export interface GameStartingMessage {
  readonly type: 'game-starting';
  readonly port: number;
  readonly token: string;
  readonly opponent: string;
}

/** Error message from the lobby. */
export interface LobbyErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

/** Union of all lobby → client messages. */
export type LobbyServerMessage =
  | OnlinePlayersMessage
  | ChallengeReceivedMessage
  | ChallengeDeclinedMessage
  | GameStartingMessage
  | LobbyErrorMessage;
