/**
 * Two pieces of text in order, by code unit.
 *
 * `localeCompare` answers differently depending on the locale it is run under, and this
 * repository sorts things whose order decides what gets published: which snapshot is the
 * newest of a world, which world heads the manifest, which file the transfer budget trims
 * first. A sort that depends on the machine it ran on is a sort that disagrees between a
 * developer's laptop and the deploy runner.
 *
 * Nothing here is presentation order. Where a list is shown to a player, that is the
 * dashboard's business and Polish collation is a legitimate thing to want — it just does
 * not decide what is written.
 */

/**
 * Negative, zero or positive, for `Array.prototype.sort`.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function getTextOrder(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
