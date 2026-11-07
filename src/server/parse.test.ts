// The request-body parser combinators: what each accepts and refuses at run
// time, and (checked by `tsc`, which covers test files) that a parser stops
// compiling when it no longer matches the type it reads.

import { describe, expect, test } from "vitest";
import { arrayOf, boolean, number, object, oneOf, optional, string, union, type Fields } from "./parse.ts";

describe("primitives", () => {
  test("each reads only its own type, and never null", () => {
    expect(string("a")).toBe("a");
    expect(string("")).toBe("");
    expect(boolean(false)).toBe(false);
    expect(number(0)).toBe(0);
    for (const value of [null, undefined, {}, [], 1, "1", true]) {
      if (typeof value !== "string") expect(string(value)).toBeNull();
      if (typeof value !== "boolean") expect(boolean(value)).toBeNull();
      if (typeof value !== "number") expect(number(value)).toBeNull();
    }
  });

  test("a number keeps its sign at zero", () => {
    expect(Object.is(number(-0), -0)).toBe(true);
  });
});

describe("oneOf", () => {
  const color = oneOf(["red", "blue"] as const);

  test("reads a member, and nothing else", () => {
    expect(color("red")).toBe("red");
    expect(color("green")).toBeNull();
    expect(color("constructor")).toBeNull();
    expect(color(["red"])).toBeNull();
    expect(color(undefined)).toBeNull();
  });
});

describe("optional", () => {
  const note = optional(string);

  test("reads undefined as left out, and refuses null or another type", () => {
    expect(note(undefined)).toBeUndefined();
    expect(note("hi")).toBe("hi");
    expect(note(null)).toBeNull();
    expect(note(1)).toBeNull();
  });
});

describe("arrayOf", () => {
  const strings = arrayOf(string);

  test("reads an array whose every item parses", () => {
    expect(strings([])).toEqual([]);
    expect(strings(["a", "b"])).toEqual(["a", "b"]);
  });

  test("refuses the whole array for one bad item, a hole, or an array-like object", () => {
    expect(strings(["a", 1])).toBeNull();
    expect(strings(["a", null])).toBeNull();
    expect(strings(["a", , "b"])).toBeNull();
    expect(strings({ length: 0 })).toBeNull();
    expect(strings("ab")).toBeNull();
  });

  test("answers a new array, not the body's", () => {
    const body = ["a"];
    expect(strings(body)).not.toBe(body);
  });
});

describe("object", () => {
  interface Body {
    name: string;
    note?: string;
  }
  const body = object<Body>({ name: string, note: optional(string) });

  test("reads each field, and leaves other keys out", () => {
    expect(body({ name: "a", note: "b", extra: 1 })).toEqual({ name: "a", note: "b" });
    expect(Object.keys(body({ name: "a", extra: 1 })!)).toEqual(["name"]);
  });

  test("leaves an omitted optional field absent, not present as undefined", () => {
    const parsed = body({ name: "a" })!;
    expect("note" in parsed).toBe(false);
    expect({ note: "kept", ...parsed }).toEqual({ note: "kept", name: "a" });
  });

  test("refuses a missing or mistyped field", () => {
    expect(body({})).toBeNull();
    expect(body({ name: 1 })).toBeNull();
    expect(body({ name: "a", note: null })).toBeNull();
  });

  test("refuses anything but a plain object", () => {
    for (const value of [null, undefined, "a", 1, true, [], ["a"]]) expect(body(value)).toBeNull();
    // An array with the right keys is still an array.
    expect(body(Object.assign(["x"], { name: "a" }))).toBeNull();
  });

  test("reads an object with no prototype", () => {
    const value: Record<string, unknown> = Object.create(null);
    value.name = "a";
    expect(body(value)).toEqual({ name: "a" });
  });

  test("reads only the body's own keys, not Object.prototype's", () => {
    const named = object<{ constructor?: string; toString?: string }>({
      constructor: optional(string),
      toString: optional(string),
    });
    expect(named({})).toEqual({});
    expect(named({ toString: "a" })).toEqual({ toString: "a" });
  });

  test("ignores a JSON __proto__ key, and the answer's prototype is untouched", () => {
    const parsed = body(JSON.parse('{"__proto__": {"polluted": true}, "name": "a"}'))!;
    expect(parsed).toEqual({ name: "a" });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect("polluted" in parsed).toBe(false);
  });

  test("a duplicated JSON key reads as its last value, as JSON.parse does", () => {
    expect(body(JSON.parse('{"name": 1, "name": "a"}'))).toEqual({ name: "a" });
  });
});

describe("union", () => {
  type Shape = { kind: "circle"; radius: number } | { kind: "dot" };
  const shape = union<Shape>({ circle: object({ radius: number }), dot: object({}) });

  test("reads each variant by its kind, leaving other keys out", () => {
    expect(shape({ kind: "circle", radius: 2, extra: 1 })).toEqual({ kind: "circle", radius: 2 });
    expect(shape({ kind: "dot", radius: 2 })).toEqual({ kind: "dot" });
  });

  test("refuses a variant whose fields don't parse", () => {
    expect(shape({ kind: "circle" })).toBeNull();
    expect(shape({ kind: "circle", radius: "2" })).toBeNull();
  });

  test("refuses an unknown, missing or non-string kind, including Object.prototype's names", () => {
    for (const kind of ["square", "constructor", "toString", "__proto__", "hasOwnProperty", undefined, 1, null]) {
      expect(shape({ kind, radius: 2 })).toBeNull();
    }
    expect(shape([{ kind: "dot" }])).toBeNull();
    expect(shape(null)).toBeNull();
  });
});

// Compile-time checks: each @ts-expect-error fails `tsc` if its line ever compiles.
describe("types", () => {
  interface Body {
    name: string;
    note?: string;
  }
  type Shape = { kind: "circle"; radius: number } | { kind: "dot" };

  test("a parser must match its type, key for key", () => {
    const fields: Fields<Body> = { name: string, note: optional(string) };
    expect(object<Body>(fields)({ name: "a" })).toEqual({ name: "a" });

    // @ts-expect-error A key the type has, with no parser.
    object<Body>({ name: string });
    // @ts-expect-error A parser for a key the type doesn't have.
    object<Body>({ name: string, note: optional(string), extra: string });
    // @ts-expect-error A parser of the wrong type.
    object<Body>({ name: number, note: optional(string) });
    // @ts-expect-error A required field read as optional.
    object<Body>({ name: optional(string), note: optional(string) });
    // @ts-expect-error A wider parser than the field's type.
    object<{ color: "red" | "blue" }>({ color: string });
  });

  test("a union parser must cover every variant, and only those", () => {
    // @ts-expect-error A variant with no parser.
    union<Shape>({ circle: object({ radius: number }) });
    // @ts-expect-error A parser for a kind the union doesn't have.
    union<Shape>({ circle: object({ radius: number }), dot: object({}), square: object({}) });
    // @ts-expect-error A variant's field of the wrong type.
    union<Shape>({ circle: object({ radius: string }), dot: object({}) });
  });
});
