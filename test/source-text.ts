// Splitting a source file into comments, code and string literals.
//
// Not a test — a helper the tests share. `dashboard.test.ts` needs the code with the prose
// removed (a paragraph explaining why a module does not reach for `document` contains that
// word), and `language.test.ts` needs the opposite halves: the comments on their own and the
// string literals on their own.
//
// These are regexes over text, not a parser, so they are approximate in exactly one direction
// that matters: a `//` or `/* */` sequence inside a string literal is read as a comment. In
// this repo that costs nothing — the URLs in the sources are matched by the `[^:]` guard, and
// a false comment can only make the language guard stricter, never blinder.

const BLOCK = /\/\*[\s\S]*?\*\//g;
const LINE = /(^|[^:])\/\/.*$/gm;

/** The source with every comment removed. */
export function stripComments(source: string): string {
  return source.replace(BLOCK, "").replace(LINE, "$1");
}

/**
 * The comments alone, consecutive `//` lines joined into one block.
 *
 * The joining matters: a sentence quoting the interface often wraps across several lines, and
 * a reader checking quote by quote would see half a quotation on each of them.
 */
export function getCommentBlocks(source: string): string[] {
  const blocks = source.match(BLOCK) ?? [];
  const lines: string[] = [];

  let currentRun: string[] = [];
  for (const line of source.split("\n")) {
    const match = /(^|[^:])\/\/(.*)$/.exec(line);
    if (match) {
      currentRun.push(match[2]!);
    } else if (currentRun.length > 0) {
      lines.push(currentRun.join("\n"));
      currentRun = [];
    }
  }
  if (currentRun.length > 0) lines.push(currentRun.join("\n"));

  return [...blocks, ...lines];
}

/**
 * The regular-expression literals, comments removed first.
 *
 * Needed because a source can hold text in a pattern and nowhere else: `parser.ts` matches
 * the ranking's "N dni temu" with a regex, and once the profession names moved out of it,
 * that pattern was the only Polish left in the file — invisible to `stringLiterals`, so the
 * language boundary would have been dropped rather than held.
 *
 * A `/` opens a literal only where a value may start, which is what the prefix class below
 * approximates. It is deliberately narrow: a division misread as a pattern would let a file
 * claim a language it does not speak.
 */
export function getRegexLiterals(source: string): string[] {
  const code = stripComments(source);
  return [...code.matchAll(/(?<=[(=,:[!&|?{};]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[dgimsuvy]*/g)].map(
    ([literal]) => literal,
  );
}

/** The string and template literals, comments removed first. */
export function getStringLiterals(source: string): string[] {
  const code = stripComments(source);
  return [
    ...(code.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []),
    ...(code.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []),
    ...(code.match(/`(?:[^`\\]|\\.)*`/g) ?? []),
  ];
}
