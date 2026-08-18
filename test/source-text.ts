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
export function stripComments(src: string): string {
  return src.replace(BLOCK, "").replace(LINE, "$1");
}

/**
 * The comments alone, consecutive `//` lines joined into one block.
 *
 * The joining matters: a sentence quoting the interface often wraps across several lines, and
 * a reader checking quote by quote would see half a quotation on each of them.
 */
export function commentBlocks(src: string): string[] {
  const blocks = src.match(BLOCK) ?? [];
  const lines: string[] = [];

  let run: string[] = [];
  for (const line of src.split("\n")) {
    const match = /(^|[^:])\/\/(.*)$/.exec(line);
    if (match) {
      run.push(match[2]!);
    } else if (run.length > 0) {
      lines.push(run.join("\n"));
      run = [];
    }
  }
  if (run.length > 0) lines.push(run.join("\n"));

  return [...blocks, ...lines];
}

/** The string and template literals, comments removed first. */
export function stringLiterals(src: string): string[] {
  const code = stripComments(src);
  return [
    ...(code.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []),
    ...(code.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []),
    ...(code.match(/`(?:[^`\\]|\\.)*`/g) ?? []),
  ];
}
