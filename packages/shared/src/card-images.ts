/**
 * @module card-images
 *
 * Utilities for card image URLs. Each card definition stores a full
 * raw GitHub URL to its remastered image. The client-web server proxies
 * these through a local caching endpoint to avoid hitting GitHub directly
 * from the browser and to cache images on disk.
 *
 * The proxy route is `/cards/images/{set}/{filename}`, which maps to the
 * upstream `en-remaster/{set}/{filename}` path in the meccg-remaster repo.
 */

import type { CardDefinition } from './types/cards.js';

/** The base prefix of all raw image URLs in the remaster repository. */
const RAW_BASE =
  'https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/';

/**
 * Converts a card's full image URL into a local proxy path for use in
 * `<img src>` attributes. The client-web server handles these paths by
 * checking a local disk cache and fetching from GitHub on cache miss.
 *
 * Example: `"https://raw.githubusercontent.com/.../en-remaster/tw/Gandalf.jpg"`
 * becomes `"/cards/images/tw/Gandalf.jpg"`.
 *
 * Returns undefined if the URL doesn't match the expected format.
 */
export function cardImageProxyPath(card: CardDefinition): string | undefined {
  if (!card.image.startsWith(RAW_BASE)) return undefined;
  const relativePath = card.image.substring(RAW_BASE.length);
  return `/cards/images/${relativePath}`;
}

/**
 * Reconstructs the full raw GitHub URL from a set code and filename.
 * Used by the server-side caching proxy to fetch images on cache miss.
 */
export function cardImageRawUrl(set: string, filename: string): string {
  return `${RAW_BASE}${set}/${filename}`;
}
