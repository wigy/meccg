/**
 * @module mail/store
 *
 * File-based mail storage for the internal mailing system. Each message
 * is stored as an individual JSON file in the player's mail directory.
 * The {@link sendMail} function is the single entry point for delivering
 * mail — it writes the inbox file and sends a real-time WebSocket
 * notification to the recipient.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PLAYERS_DIR } from '../config.js';
import { notifyPlayer } from '../lobby/lobby.js';
import { toDirName } from '../players/store.js';
import type { MailMessage, MailSender, MailStatus, MailTopic } from './types.js';

/** Path to a player's mail inbox directory. */
function inboxDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'inbox');
}

/**
 * Read and parse a mail JSON file, normalizing `updatedAt` to `timestamp` if
 * absent (older files written before `updatedAt` was introduced).
 */
function loadMail(filePath: string): MailMessage {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage & { updatedAt?: string };
  return raw.updatedAt ? raw : { ...raw, updatedAt: raw.timestamp };
}

/** Path to a player's deleted mail directory. */
function deletedDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'deleted');
}

/** Path to a player's sent mail directory. */
function sentDir(playerName: string): string {
  return path.join(PLAYERS_DIR, toDirName(playerName), 'mail', 'sent');
}

/** Fields required when composing a new message (id, timestamp, status are generated). */
export interface SendMailOptions {
  /** Human-readable sender name. */
  readonly from: string;
  /** Fixed sender category. */
  readonly sender: MailSender;
  /** Message topic for categorization. */
  readonly topic: MailTopic;
  /** Full message body in Markdown format. */
  readonly body: string;
  /** Human-readable subject line. */
  readonly subject: string;
  /** Named references relevant to this message (e.g. deckId, cardName). */
  readonly keywords: Readonly<Record<string, string>>;
  /** If set, a copy of the message is saved to this player's sent folder. */
  readonly sentBy?: string;
  /** Message ID this is a reply to. */
  readonly replyTo?: string;
}

/**
 * Single entry point for sending mail. Generates a unique ID, writes an
 * inbox file for each recipient, and pushes a WebSocket notification to
 * online recipients.
 *
 * @returns The generated message ID (shared across all recipients).
 */
export function sendMail(recipients: readonly string[], options: SendMailOptions): string {
  const id = crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();

  const message: MailMessage = {
    id,
    status: 'new',
    from: options.from,
    sender: options.sender,
    topic: options.topic,
    body: options.body,
    timestamp,
    updatedAt: timestamp,
    subject: options.subject,
    keywords: options.keywords,
    recipients: [...recipients],
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  };

  for (const recipient of recipients) {
    const dir = inboxDir(recipient);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(message, null, 2));

    const unread = countUnread(recipient);
    notifyPlayer(recipient, { type: 'mail-notification', unreadCount: unread });
    notifyPlayer(recipient, { type: 'system-notification', message: 'You have NEW mail' });
  }

  if (options.sentBy) {
    writeSentCopy(options.sentBy, message);
  }

  return id;
}

/** Write a copy of a message to a player's sent folder. */
export function writeSentCopy(playerName: string, message: MailMessage): void {
  const dir = sentDir(playerName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${message.id}.json`), JSON.stringify(message, null, 2));
}

/** List all messages in a player's sent folder, sorted by timestamp descending (newest first). */
export function listSent(playerName: string): MailMessage[] {
  const dir = sentDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const messages = files.map(f => loadMail(path.join(dir, f)));
    return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

/** List all messages in a player's inbox, sorted by timestamp descending (newest first). */
export function listInbox(playerName: string): MailMessage[] {
  const dir = inboxDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const messages = files.map(f => loadMail(path.join(dir, f)));
    return messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

/**
 * Read a message from a player's inbox. If the message has status 'new',
 * it is updated to 'read' on disk.
 *
 * @returns The message, or null if not found.
 */
export function readMessage(playerName: string, msgId: string): MailMessage | null {
  const filePath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(filePath);
    if (message.status === 'new' && message.topic !== 'review-request' && message.topic !== 'feature-request' && message.topic !== 'bug-report') {
      const updatedAt = new Date().toISOString();
      const updated: MailMessage = { ...message, status: 'read', updatedAt };
      fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
      updateSentCopies(msgId, 'read', updatedAt);
      return updated;
    }
    return message;
  } catch {
    return null;
  }
}

/**
 * Update a message's status and optionally set the success field.
 *
 * @returns The updated message, or null if not found.
 */
export function updateMessageStatus(playerName: string, msgId: string, status: MailStatus, success?: boolean): MailMessage | null {
  const filePath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(filePath);
    const updatedAt = new Date().toISOString();
    const updated: MailMessage = { ...message, status, updatedAt, ...(success !== undefined ? { success } : {}) };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    updateSentCopies(msgId, status, updatedAt, success);
    notifyPlayer(playerName, { type: 'mail-notification', unreadCount: countUnread(playerName) });
    return updated;
  } catch {
    return null;
  }
}

/** Update all sent-folder copies of a message across all players. */
function updateSentCopies(msgId: string, status: MailStatus, updatedAt: string, success?: boolean): void {
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(PLAYERS_DIR, entry.name, 'mail', 'sent', `${msgId}.json`);
      try {
        const message = loadMail(filePath);
        const updated: MailMessage = { ...message, status, updatedAt, ...(success !== undefined ? { success } : {}) };
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
      } catch { /* file doesn't exist for this player */ }
    }
  } catch { /* players dir doesn't exist */ }
}

/**
 * Move a message from inbox to the deleted folder, updating its status
 * to 'deleted'.
 *
 * @returns True if the message was found and deleted, false otherwise.
 */
export function deleteMessage(playerName: string, msgId: string): boolean {
  const srcPath = path.join(inboxDir(playerName), `${msgId}.json`);
  try {
    const message = loadMail(srcPath);
    const destDir = deletedDir(playerName);
    fs.mkdirSync(destDir, { recursive: true });
    const updated: MailMessage = { ...message, status: 'deleted', updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(destDir, `${msgId}.json`), JSON.stringify(updated, null, 2));
    fs.unlinkSync(srcPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * A pending request surfaced to the AI worker via the system API. This is
 * the API-side equivalent of what `bin/requests` produces by grepping the
 * on-disk inboxes directly.
 */
export interface UnhandledRequest {
  /** Message ID. */
  readonly id: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Message topic. */
  readonly topic: MailTopic;
  /** Message status (always 'new' here, but surfaced for clarity). */
  readonly status: MailStatus;
  /** Subject line. */
  readonly subject: string;
  /** Sender display name. */
  readonly from: string;
  /** Keywords carried on the message. */
  readonly keywords: Readonly<Record<string, string>>;
  /** Inbox the request was found in (e.g. 'ai' or 'admin'). */
  readonly inbox: string;
}

/**
 * Collect request messages across the given inboxes. A request is any
 * message whose topic ends in '-request' or is exactly 'bug-report'. By
 * default only status='new' (unhandled) requests are returned so that
 * `bin/run-ai` processes the FIFO queue of work still to do. Pass
 * `{ includeAll: true }` to include handled/waiting/processing ones as
 * well — used by administrative listings (`bin/requests --all`). Results
 * are ordered oldest-first.
 */
export function listUnhandledRequests(
  inboxes: readonly string[],
  options: { includeAll?: boolean } = {},
): UnhandledRequest[] {
  const includeAll = options.includeAll === true;
  const out: UnhandledRequest[] = [];
  for (const inbox of inboxes) {
    for (const msg of listInbox(inbox)) {
      if (!includeAll && msg.status !== 'new') continue;
      if (!(msg.topic.endsWith('-request') || msg.topic === 'bug-report')) continue;
      out.push({
        id: msg.id,
        timestamp: msg.timestamp,
        topic: msg.topic,
        status: msg.status,
        subject: msg.subject,
        from: msg.from,
        keywords: msg.keywords,
        inbox,
      });
    }
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

/**
 * Count messages in a player's inbox that need attention: status 'new', plus
 * review-requests in 'waiting' state (the reviewer still has to approve/decline).
 */
export function countUnread(playerName: string): number {
  const dir = inboxDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let count = 0;
    for (const f of files) {
      try {
        const msg = loadMail(path.join(dir, f));
        if (msg.status === 'new') count++;
        else if (msg.topic === 'review-request' && msg.status === 'waiting') count++;
      } catch {
        // Skip malformed files
      }
    }
    return count;
  } catch {
    return 0;
  }
}
