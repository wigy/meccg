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

/** Start a game against the heuristic ("Smart") AI. */
export interface PlaySmartAiMessage {
  readonly type: 'play-smart-ai';
  /** Catalog deck ID for the AI opponent to use. */
  readonly deckId: string;
}

/** Start a game against the pseudo-AI (human controls both sides). */
export interface PlayPseudoAiMessage {
  readonly type: 'play-pseudo-ai';
  /** Catalog deck ID for the pseudo-AI opponent to use. */
  readonly deckId: string;
}

/** Forward the human's chosen action to the pseudo-AI client. */
export interface PseudoAiPickMessage {
  readonly type: 'pseudo-ai-pick';
  /** The action chosen by the human for the AI player. */
  readonly action: import('@meccg/shared').GameAction;
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
  | PlaySmartAiMessage
  | PlayPseudoAiMessage
  | PseudoAiPickMessage
  | RejoinGameMessage;

// ---- Lobby → Client ----

/** An online player entry with identity, display name, and credits. */
export interface OnlinePlayerEntry {
  readonly name: string;
  readonly displayName: string;
  readonly credits: number;
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
  /** True when the opponent is a pseudo-AI controlled by the human player. */
  readonly pseudoAi?: boolean;
  /** Game token for the AI player (pseudo-AI mode only — human controls both sides). */
  readonly aiToken?: string;
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

/** Pseudo-AI legal actions forwarded to the human player for decision. */
export interface PseudoAiActionsMessage {
  readonly type: 'pseudo-ai-actions';
  /** The AI player's evaluated legal actions. */
  readonly actions: readonly import('@meccg/shared').EvaluatedAction[];
  /** Current game phase name. */
  readonly phase: string;
}

/** Union of all lobby → client messages. */
export type LobbyServerMessage =
  | OnlinePlayersMessage
  | ChallengeReceivedMessage
  | ChallengeDeclinedMessage
  | GameStartingMessage
  | LobbyErrorMessage
  | SystemNotificationMessage
  | MailNotificationMessage
  | PseudoAiActionsMessage;
