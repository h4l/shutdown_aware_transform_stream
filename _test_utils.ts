// Copyright 2021-2022 Hal Blackburn. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  AssertionError,
  assertStrictEquals,
} from "./dev_deps.ts";

export type CloseEvent = { type: "close" };
export type AbortEvent = { type: "abort"; reason: unknown };
export type ConsumedStreamEvents<T> = {
  chunks: ReadonlyArray<T>;
  end: CloseEvent | AbortEvent;
};

export async function consumeStream<T>(
  stream: ReadableStream<T>,
): Promise<ConsumedStreamEvents<T>> {
  const chunks: T[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (reason: unknown) {
    return { chunks, end: { type: "abort", reason } };
  }
  return { chunks, end: { type: "close" } };
}

// deno-lint-ignore no-explicit-any
type Constructor<T> = new (...args: any[]) => T;
type ErrorEqualityAssert<E extends Error> = {
  equalityMatchType(error: E): "exact" | "partial" | "none";
  assertEquals(actual: E, expected: E): void;
};
type T = ConstructorParameters<typeof Error>;
function errorEqualityAssertor<E extends Error>(
  type: Constructor<E> | ReadonlyArray<Constructor<E>>,
  assertionFn: (actual: E, expected: E) => void,
): ErrorEqualityAssert<E> {
  const types = [...(Array.isArray(type) ? type : [type])];
  return {
    equalityMatchType(error: E): "exact" | "partial" | "none" {
      return types.some((t) => error.constructor === t)
        ? "exact"
        : (types.some((t) => error instanceof t) ? "partial" : "none");
    },
    assertEquals(actual: E, expected: E) {
      assertStrictEquals(actual.constructor, expected.constructor);
      assert(types.some((t) => expected instanceof t));
      assertionFn(actual, expected);
    },
  };
}

const errorEqualityAssertors: Set<ErrorEqualityAssert<Error>> = new Set([
  errorEqualityAssertor(
    [Error, RangeError, TypeError, URIError],
    (expected, actual) => {
      assertStrictEquals(actual.constructor, expected.constructor);
      assertEquals(actual.message, expected.message);
      if (expected.cause instanceof Error) {
        assertErrorEquals(actual.cause, expected.cause);
      }
    },
  ),
  errorEqualityAssertor(AggregateError, (actual, expected) => {
    assertEquals(actual.errors, expected.errors);
    expected.errors.forEach((e, i) => {
      assertErrorEquals(actual.errors[i], e);
    });
  }),
]);

/** Throw an AssertionError if two Error instances are not equal.
 *
 * Note that currently assertEqual() from std does not handle Errors correctly.
 * Only the type is checked, not the message, cause etc.
 */
export function assertErrorEquals(
  actual: unknown,
  expected: Error | AggregateError,
) {
  assert(
    actual instanceof Error,
    `actual is not an Error: ${Deno.inspect(actual)}`,
  );
  const assertors = [...errorEqualityAssertors].map((a) => ({
    assertor: a,
    matchType: a.equalityMatchType(expected),
  })).filter(({ matchType }) => matchType !== "none");
  // Ensure we have an exact match for the type, otherwise subclasses of
  // supported types could match.
  assert(
    assertors.find(({ matchType }) => matchType === "exact"),
    "No exact assertion function defined for type " +
      `${expected.constructor} - ${expected}`,
  );
  try {
    assertors.forEach(({ assertor }) =>
      assertor.assertEquals(actual, expected)
    );
  } catch (e) {
    if (!(e instanceof AssertionError)) {
      throw e;
    }

    throw new AssertionError(`Errors are not equal:
  actual: ${formatError(actual)}
  expected: ${formatError(expected)}`);
  }
}

function formatError(e: unknown): string {
  if (!(e instanceof Error)) return Deno.inspect(e);
  return JSON.stringify(errorAsJson(e), undefined, 2);
}
// TODO(h4l): probably simpler to just use key functions like this and pass the
//   result to the regular assertEquals(), that way we get diffs for free.
function errorAsJson(e: Error): unknown {
  return e instanceof AggregateError
    ? _aggregateErrorAsJson(e)
    : _errorAsJson(e);
}

function _errorAsJson(e: Error): Record<string, unknown> {
  return {
    name: e.name,
    message: e.message,
    ...(e.cause ? { cause: formatError(e.cause) } : {}),
  };
}

function _aggregateErrorAsJson(e: AggregateError): Record<string, unknown> {
  return { ..._errorAsJson(e), errors: e.errors.map(errorAsJson) };
}
