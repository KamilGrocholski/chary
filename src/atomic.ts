import { rename, unlink } from "node:fs/promises";

/**
 * A write that either replaces the file entirely or does not touch it at all.
 *
 * `Bun.write` is truncate + write, so an interruption partway through — Ctrl-C, a full
 * disk, an OOM — leaves the file truncated. That is the worst failure available in this
 * repo: the data in `public/worlds/` cannot be reproduced (rule #6), and a corrupted
 * snapshot took down `JSON.parse` while building the manifest and the trends, which is
 * **both** the tail of a 1.6-hour round **and** the `bun run rebuild` meant to repair it.
 *
 * `rename` within a single directory is atomic on POSIX: a reader sees either the old
 * contents or the new ones, never half of each.
 */
export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  try {
    await Bun.write(temporaryPath, contents);
    await rename(temporaryPath, filePath);
  } catch (error) {
    // The temp file must not survive: a `.tmp` in `public/worlds/` would ship to Pages,
    // and on the next write it would pretend everything was fine.
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
