import { describe, expect, test } from "bun:test";
import { AssertionFailure, assert, assertDefined } from "@/public/lib/assert.js";
import {
  composeIntegerText,
  getFiniteNumberFromText,
  getFiniteNumberFromValue,
  getIntegerFromText,
  getIntegerFromValue,
} from "@/public/lib/number.js";
import { composeJsonText, getValueFromJsonText } from "@/public/lib/json.js";
import { getDateFromIsoText, getMillisecondsFromIsoText } from "@/public/lib/timestamp.js";
import { getTextOrder } from "@/public/lib/text-order.js";

// The floor of the repository: the only place a number, a JSON document or a date is read.
// Every case below is a value JavaScript would otherwise have answered with on its own —
// see the docblocks in public/lib/ for which spelling produced which surprise.

describe("assert", () => {
  test("a held invariant returns nothing and throws nothing", () => {
    expect(() => assert(true, "holds")).not.toThrow();
  });

  test("a broken invariant throws its own type, outside both error hierarchies", () => {
    expect(() => assert(false, "the column holds a row")).toThrow(AssertionFailure);
    expect(() => assert(false, "the column holds a row")).toThrow("the column holds a row");
  });

  test("the failure is branded, because it shares a console", () => {
    try {
      assert(false, "x");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).name).toBe("MargoStat/Assertion");
    }
  });

  test("it carries no code — nobody handles a broken invariant", () => {
    expect("code" in new AssertionFailure("x")).toBe(false);
  });
});

describe("assertDefined", () => {
  test("narrows away null and undefined", () => {
    expect(() => assertDefined(null, "there")).toThrow(AssertionFailure);
    expect(() => assertDefined(undefined, "there")).toThrow(AssertionFailure);
  });

  // The values this repository reads all day: `days: 0` is "online today" and honor of 0
  // is a measurement. A truthiness check here would throw both away.
  test.each([[0], [""], [false], [NaN]] as const)("%p passes — it is a value, not an absence", (value) => {
    expect(assertDefined(value, "there")).toBe(value);
  });
});

describe("getIntegerFromText", () => {
  test.each([
    ["0", 0],
    ["-35", -35],
    ["600630", 600630],
  ] as const)("%p → %p", (text, expected) => {
    expect(getIntegerFromText(text)).toBe(expected);
  });

  // Each of these is a number `Number()` or `parseInt` would have invented.
  test.each([
    ["", null],
    [" 5 ", null],
    ["0x10", null],
    ["1e3", null],
    ["12abc", null],
    ["3.5", null],
    ["+5", null],
    ["9007199254740993", null],
  ] as const)("%p is refused → %p", (text, expected) => {
    expect(getIntegerFromText(text)).toBe(expected);
  });
});

describe("getFiniteNumberFromText", () => {
  test.each([
    ["0.05", 0.05],
    ["1", 1],
    ["-0.5", -0.5],
    ["", null],
    [".5", null],
    ["1e3", null],
    ["0x1", null],
  ] as const)("%p → %p", (text, expected) => {
    expect(getFiniteNumberFromText(text)).toBe(expected);
  });
});

describe("reading a value that came out of JSON", () => {
  test.each([
    [7, 7],
    ["7", 7],
    [" 7 ", 7],
    [null, null],
    [undefined, null],
    [7.5, null],
    [true, null],
    [{}, null],
    [[], null],
  ] as const)("getIntegerFromValue(%p) → %p", (value, expected) => {
    expect(getIntegerFromValue(value)).toBe(expected);
  });

  // The one that mattered: `Number(undefined)` is NaN, and NaN reaches a written file as
  // `null` after JSON.stringify — a value nobody wrote, in the only copy there is.
  test("a missing field never becomes a number", () => {
    expect(getIntegerFromValue(undefined)).toBeNull();
    expect(getFiniteNumberFromValue(undefined)).toBeNull();
  });
});

describe("composeIntegerText", () => {
  test("writes a number of ours", () => {
    expect(composeIntegerText(-35)).toBe("-35");
  });

  test("asserts rather than answering, because by then the number is ours", () => {
    expect(() => composeIntegerText(1.5)).toThrow(AssertionFailure);
    expect(() => composeIntegerText(NaN)).toThrow(AssertionFailure);
  });
});

describe("getValueFromJsonText", () => {
  test("a document reads as its value", () => {
    expect(getValueFromJsonText('{"count":3}')).toEqual({ ok: true, value: { count: 3 } });
  });

  // A file holding the four characters `null` is a legitimate document, and must not read
  // the same as a file that is not JSON at all.
  test("a null document is a reading, not a failure", () => {
    expect(getValueFromJsonText("null")).toEqual({ ok: true, value: null });
  });

  test("a truncated file answers with the SyntaxError instead of throwing", () => {
    const reading = getValueFromJsonText('{"count":3');
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.error).toBeInstanceOf(SyntaxError);
  });

  test("an empty file is not a document", () => {
    expect(getValueFromJsonText("").ok).toBe(false);
  });
});

describe("composeJsonText", () => {
  test("writes a value JSON can carry", () => {
    expect(composeJsonText({ a: 1 })).toBe('{"a":1}');
  });

  test("refuses a value JSON cannot carry, rather than writing `undefined` as a file", () => {
    expect(composeJsonText(undefined)).toBeNull();
    expect(composeJsonText(() => 1)).toBeNull();
  });
});

describe("getMillisecondsFromIsoText", () => {
  test("reads the one trustworthy time in the system", () => {
    expect(getMillisecondsFromIsoText("2026-07-21T20:04:12.489Z")).toBe(Date.parse("2026-07-21T20:04:12.489Z"));
  });

  // NaN compares false against everything, so an unreadable date sorts as neither earlier
  // nor later and lands nowhere while reporting no failure.
  test.each([["nope"], [""], [null], [undefined]] as const)("%p → null, never NaN", (text) => {
    expect(getMillisecondsFromIsoText(text)).toBeNull();
  });

  test("getDateFromIsoText answers null rather than an Invalid Date", () => {
    expect(getDateFromIsoText("nope")).toBeNull();
    expect(getDateFromIsoText("2026-07-21T20:04:12.489Z")).toBeInstanceOf(Date);
  });
});

describe("getTextOrder", () => {
  test("orders by code unit, so a sort decides the same thing on every machine", () => {
    expect(["b", "a", "c"].sort(getTextOrder)).toEqual(["a", "b", "c"]);
    expect(getTextOrder("a", "a")).toBe(0);
  });

  // The property that matters: what it answers cannot depend on a locale.
  test("uppercase sorts before lowercase, as code units do", () => {
    expect(getTextOrder("Z", "a")).toBeLessThan(0);
  });
});
