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
    subject: options.subject,
    keywords: options.keywords,
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
    const dir = sentDir(options.sentBy);
    fs.mkdirSync(dir, { recursive: true });
    const sentMessage: MailMessage = { ...message };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(sentMessage, null, 2));
  }

  return id;
}

/** List all messages in a player's sent folder, sorted by timestamp descending (newest first). */
export function listSent(playerName: string): MailMessage[] {
  const dir = sentDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const messages = files.map(f =>
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MailMessage,
    );
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
    const messages = files.map(f =>
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MailMessage,
    );
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
    const message = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage;
    if (message.status === 'new' && message.topic !== 'review-request' && message.topic !== 'feature-request') {
      const updated: MailMessage = { ...message, status: 'read' };
      fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
      updateSentCopies(msgId, 'read');
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
    const message = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage;
    const updated: MailMessage = { ...message, status, ...(success !== undefined ? { success } : {}) };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    updateSentCopies(msgId, status, success);
    return updated;
  } catch {
    return null;
  }
}

/** Update all sent-folder copies of a message across all players. */
function updateSentCopies(msgId: string, status: MailStatus, success?: boolean): void {
  try {
    const entries = fs.readdirSync(PLAYERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(PLAYERS_DIR, entry.name, 'mail', 'sent', `${msgId}.json`);
      try {
        const message = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage;
        const updated: MailMessage = { ...message, status, ...(success !== undefined ? { success } : {}) };
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
    const message = JSON.parse(fs.readFileSync(srcPath, 'utf-8')) as MailMessage;
    const destDir = deletedDir(playerName);
    fs.mkdirSync(destDir, { recursive: true });
    const updated: MailMessage = { ...message, status: 'deleted' };
    fs.writeFileSync(path.join(destDir, `${msgId}.json`), JSON.stringify(updated, null, 2));
    fs.unlinkSync(srcPath);
    return true;
  } catch {
    return false;
  }
}

/** Mark all read messages in a player's inbox as unread. */
export function markAllUnread(playerName: string): number {
  const dir = inboxDir(playerName);
  let count = 0;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const filePath = path.join(dir, f);
      try {
        const msg = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MailMessage;
        if (msg.status === 'read') {
          const updated: MailMessage = { ...msg, status: 'new' };
          fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
          count++;
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* dir doesn't exist */ }
  return count;
}

/** Count messages in a player's inbox with status 'new'. */
export function countUnread(playerName: string): number {
  const dir = inboxDir(playerName);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let count = 0;
    for (const f of files) {
      try {
        const msg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MailMessage;
        if (msg.status === 'new') count++;
      } catch {
        // Skip malformed files
      }
    }
    return count;
  } catch {
    return 0;
  }
}
