/**
 * Assertions: the things that must never happen.
 *
 * A different category from `MargoStatError` and `MargoStatToolError`, and the difference
 * is why this sits outside both hierarchies. Those describe failures we know CAN happen —
 * a ranking page that changed shape, a truncated snapshot, a world that answered 429 — so
 * they carry a `code`, because a code exists for somebody to recognise and handle the
 * failure.
 *
 * A broken assertion has no code, because nobody handles it. The only correct response is
 * to fix the program, and a code here would promise a reaction that does not exist.
 *
 * Falling out of that: a `catch` testing `instanceof MargoStatError` does not treat a
 * broken assertion as a domain failure, because it is not one. It travels upwards instead
 * of being turned into a wrong number further down — which matters most in the one place
 * this repository cannot undo, the write into `public/worlds/`.
 *
 * Where it broke comes from the stack, exact file and line. What broke comes from a
 * message naming the invariant.
 */

export class AssertionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MargoStat/Assertion";
  }
}

/** @param invariant what must hold, stated as a fact — not the condition's source */
export function assert(condition: unknown, invariant: string): asserts condition {
  if (!condition) throw new AssertionFailure(invariant);
}

/**
 * Narrows away `null` and `undefined`, and nothing else: `0` and `""` pass.
 *
 * A truthiness check here would reject values this repository reads all day — `days: 0`
 * means "online today" and a honor of `0` is a measurement, so both are exactly the
 * readings a looser assert would throw away.
 */
export function assertDefined<Value>(value: Value | null | undefined, invariant: string): Value {
  if (value === null || value === undefined) throw new AssertionFailure(invariant);
  return value;
}
