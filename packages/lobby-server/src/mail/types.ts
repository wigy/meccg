/**
 * @module mail/types
 *
 * Data types for the internal mailing system. Messages are stored as
 * individual JSON files in each player's mail directory, enabling
 * asynchronous communication between the server/AI and players.
 */

/** Message status lifecycle: new → read → deleted, or new → processing → processed → waiting → approved/declined. */
export type MailStatus = 'new' | 'read' | 'deleted' | 'processing' | 'processed' | 'waiting' | 'approved' | 'declined';

/** Who originated the message. */
export type MailSender = 'ai' | 'server' | 'player';

/** Message topic categories for filtering and routing. */
export type MailTopic =
  | 'card-request'
  | 'card-reply'
  | 'certification-request'
  | 'certification-reply'
  | 'review-request'
  | 'feature-request'
  | 'feature-reply'
  | 'feature-planning-request'
  | 'bug-fix-request';

/** A mail message stored in a player's inbox or deleted folder. */
export interface MailMessage {
  /** Globally unique ID. Same ID is shared across all recipients of a single send. */
  readonly id: string;
  /** Current lifecycle status. */
  readonly status: MailStatus;
  /** Human-readable sender name (e.g. "Card Certification Bot"). */
  readonly from: string;
  /** Fixed sender category. */
  readonly sender: MailSender;
  /** Message topic for categorization. */
  readonly topic: MailTopic;
  /** Full message body in Markdown format. */
  readonly body: string;
  /** ISO 8601 timestamp of when the message was created. */
  readonly timestamp: string;
  /** Human-readable subject line, may include card names or other specifics. */
  readonly subject: string;
  /** Named references relevant to this message (e.g. deckId, cardName). */
  readonly keywords: Readonly<Record<string, string>>;
  /** Whether processing succeeded. Only set when status is 'processed'. */
  readonly success?: boolean;
  /** Message ID this is a reply to. */
  readonly replyTo?: string;
}
