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
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
}

/** Request the lobby to relaunch a game server after the previous one died. */
export interface RejoinGameMessage {
  readonly type: 'rejoin-game';
  /** Name of the opponent from the previous game session. */
  readonly opponent: string;
}

/** Union of all client → lobby messages. */
export type LobbyClientMessage =
  | ChallengeMessage
  | AcceptChallengeMessage
  | DeclineChallengeMessage
  | PlayAiMessage
  | RejoinGameMessage;

// ---- Lobby → Client ----

/** An online player entry with identity and display name. */
export interface OnlinePlayerEntry {
  readonly name: string;
  readonly displayName: string;
}

/** Broadcast of all currently online players. */
export interface OnlinePlayersMessage {
  readonly type: 'online-players';
  readonly players: readonly OnlinePlayerEntry[];
}

/** Incoming challenge from another player. */
export interface ChallengeReceivedMessage {
  readonly type: 'challenge-received';
  readonly from: string;
  readonly fromDisplayName: string;
}

/** A challenge you sent was declined. */
export interface ChallengeDeclinedMessage {
  readonly type: 'challenge-declined';
  readonly by: string;
  readonly byDisplayName: string;
}

/** A game is starting — connect to the game server. */
export interface GameStartingMessage {
  readonly type: 'game-starting';
  readonly port: number;
  readonly token: string;
  readonly opponent: string;
  readonly opponentDisplayName: string;
}

/** Error message from the lobby. */
export interface LobbyErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

/** System notification broadcast to all online players. */
export interface SystemNotificationMessage {
  readonly type: 'system-notification';
  readonly message: string;
}

/** Notification that the player has new mail. Sent when mail arrives. */
export interface MailNotificationMessage {
  readonly type: 'mail-notification';
  /** Number of unread messages in the player's inbox. */
  readonly unreadCount: number;
}

/** Union of all lobby → client messages. */
export type LobbyServerMessage =
  | OnlinePlayersMessage
  | ChallengeReceivedMessage
  | ChallengeDeclinedMessage
  | GameStartingMessage
  | LobbyErrorMessage
  | SystemNotificationMessage
  | MailNotificationMessage;
