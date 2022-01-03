// Copyright 2021 Hal Blackburn. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  AssertionError,
  assertMatch,
  assertStrictEquals,
  assertThrows,
} from "./dev_deps.ts";
import { assertErrorEquals } from "./_test_utils.ts";

class CustomError extends Error {}
class CustomAggregateError extends AggregateError {}

type ErrorCases = ReadonlyArray<[Error, Error]>;
const unequalErrorCases: ErrorCases = [
  [new Error("a"), new Error("b")],
  [
    new Error("a", { cause: new Error("c") }),
    new Error("a", { cause: new Error("d") }),
  ],
  [new RangeError("foo"), new RangeError("bar")],
  [new AggregateError([new Error("a")]), new AggregateError([new Error("b")])],
  [
    new AggregateError([new Error("a")], "a"),
    new AggregateError([new Error("a")], "b"),
  ],
  [
    new AggregateError([new Error("a")], "a"),
    new AggregateError([new CustomError("a")], "a"),
  ],
];

const unequalSubclassesWithEqualProperties: ErrorCases = [
  [new Error("a"), new CustomError("a")],
  [new Error("a"), new TypeError("a")],
  [new Error("a"), new RangeError("a")],
  [
    new AggregateError([new Error("a")], "a"),
    new CustomAggregateError([new Error("a")], "a"),
  ],
];

Deno.test("std/testing/asserts#assertEquals does not consider properties of Error objects", () => {
  // all of these shouldn't be equal but currently are
  for (const [a, b] of unequalErrorCases) {
    assertEquals(a, b);
  }
});

Deno.test("assertErrorEquals() - unequal instances of same class", () => {
  for (const [a, b] of unequalErrorCases) {
    assertThrows(
      () => assertErrorEquals(a, b),
      AssertionError,
      "Errors are not equal:\n",
    );
  }
});

Deno.test("assertErrorEquals() - unequal subclasses with equal properties", () => {
  for (const [a, b] of unequalSubclassesWithEqualProperties) {
    assertThrows(
      () => assertErrorEquals(a, b),
      (err: unknown) => {
        assert(err instanceof Error);
        assertStrictEquals(err.constructor, AssertionError);
        assertMatch(
          err.message,
          /No exact assertion function defined for type|Errors are not equal:/,
        );
      },
    );
  }
});

Deno.test("assertErrorEquals() - equal errors", () => {
  const types = [Error, RangeError, TypeError, URIError];
  for (const Type of types) {
    assertErrorEquals(new Type("a"), new Type("a"));
  }
  assertErrorEquals(new AggregateError([], "a"), new AggregateError([], "a"));
  assertErrorEquals(
    new AggregateError([new Error("a")], "b"),
    new AggregateError([new Error("a")], "b"),
  );
});
