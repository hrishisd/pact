// Request-body parsers, without a schema library: they check shape only (the
// core judges content) and answer null for a body of another shape. No parsed
// type includes null, so null always means "not this shape".

/** Reads an unknown value as a T, or null when it isn't one. */
export type Parser<T> = (value: unknown) => T | null;

/** A parser for each of T's keys: a key added to T is a compile error until its parser is too. */
export type Fields<T> = { [K in keyof T]-?: Parser<T[K]> };

export const string: Parser<string> = (value) => (typeof value === "string" ? value : null);
export const boolean: Parser<boolean> = (value) => (typeof value === "boolean" ? value : null);
export const number: Parser<number> = (value) => (typeof value === "number" ? value : null);

/** One of `list`'s members. */
export function oneOf<T>(list: readonly T[]): Parser<T> {
  const members: readonly unknown[] = list;
  return (value) => (members.includes(value) ? (value as T) : null);
}

/** Left out (undefined), or what `parse` reads. An object leaves an undefined field out of its result. */
export function optional<T>(parse: Parser<T>): Parser<T | undefined> {
  return (value) => (value === undefined ? undefined : parse(value));
}

export function arrayOf<T>(parse: Parser<T>): Parser<T[]> {
  return (value) => {
    if (!Array.isArray(value)) return null;
    const items: T[] = [];
    for (const item of value) {
      const parsed = parse(item);
      if (parsed === null) return null;
      items.push(parsed);
    }
    return items;
  };
}

/**
 * A JSON object with each of `fields`; other keys are ignored and left out.
 * Only the object's own keys count, so a field named like an Object.prototype
 * member (`constructor`, `toString`) reads as left out when the body omits it.
 */
export function object<T>(fields: Fields<T>): Parser<T> {
  return (value) => {
    if (!isRecord(value)) return null;
    const parsed: Record<string, unknown> = {};
    for (const [key, parse] of Object.entries<Parser<unknown>>(fields)) {
      const field = parse(Object.hasOwn(value, key) ? value[key] : undefined);
      if (field === null) return null;
      if (field !== undefined) parsed[key] = field;
    }
    return parsed as T;
  };
}

/** A union tagged by `kind`: each variant's other fields, by its kind. */
export function union<T extends { kind: string }>(variants: {
  [Kind in T["kind"]]: Parser<Omit<Extract<T, { kind: Kind }>, "kind">>;
}): Parser<T> {
  const parsers: Partial<Record<string, Parser<object>>> = variants;
  return (value) => {
    if (!isRecord(value) || typeof value.kind !== "string" || !Object.hasOwn(parsers, value.kind)) return null;
    const rest = parsers[value.kind]!(value);
    return rest && ({ kind: value.kind, ...rest } as T);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
