import {
  ShutdownAwareTransformer,
  ShutdownAwareTransformStream,
  ShutdownAwareTransformStreamController,
  ShutdownAwareTransformStreamOptions,
} from "./shutdown_aware_transform_stream.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  delay,
  readableStreamFromIterable,
  unreachable,
} from "./dev_deps.ts";
import { assertErrorEquals, consumeStream } from "./_test_utils.ts";

Deno.test("type defs", () => {
  const transformer: ShutdownAwareTransformer<string, number> = {
    start(
      _controller: ShutdownAwareTransformStreamController<number>,
    ): void | PromiseLike<void> {},
    transform(
      _chunk: string,
      _controller: ShutdownAwareTransformStreamController<number>,
    ): void | PromiseLike<void> {},
    flush(
      _controller: ShutdownAwareTransformStreamController<number>,
    ): void | PromiseLike<void> {},
    close() {},
  };

  const options: ShutdownAwareTransformStreamOptions<string, number> = {
    transformer,
    writableStrategy: {
      highWaterMark: 1,
      size(_chunk: string) {
        return 1;
      },
    },
    readableStrategy: {
      highWaterMark: 1,
      size(_chunk: number) {
        return 1;
      },
    },
  };

  const _transform1 = new ShutdownAwareTransformStream();
  const _transform2: ShutdownAwareTransformStream<string, number> =
    new ShutdownAwareTransformStream(options);
  const _transform3 = new ShutdownAwareTransformStream<string, number>(options);
});

type TransformStreamOptions<I = unknown, O = unknown> =
  & Omit<ShutdownAwareTransformStreamOptions<I, O>, "transformer">
  & { transformer?: Transformer<I, O> };
const comparisonCases = [
  {
    createStream: (options: TransformStreamOptions) =>
      new TransformStream(
        options.transformer,
        options.writableStrategy,
        options.readableStrategy,
      ),
    label: "TransformStream",
  },
  {
    createStream: (options: TransformStreamOptions) =>
      new ShutdownAwareTransformStream(options),
    label: "ShutdownAwareTransformStream",
  },
] as const;

comparisonCases.forEach(({ createStream, label }) => {
  Deno.test(`${label} no-op transformer passes chunks unchanged`, async () => {
    const tx = createStream({});
    assertEquals(
      await consumeStream(
        readableStreamFromIterable([1, 2, 3]).pipeThrough(tx),
      ),
      {
        chunks: [1, 2, 3],
        end: { type: "close" },
      },
    );
  });
});

comparisonCases.forEach(({ createStream, label }) => {
  Deno.test(`${label} starts, transforms and flushes`, async () => {
    const tx = createStream({
      transformer: {
        start(controller) {
          controller.enqueue("start chunk");
        },
        transform(chunk, controller) {
          controller.enqueue(`${chunk}`);
        },
        flush(controller) {
          controller.enqueue("flush chunk");
        },
      },
    });
    assertEquals(
      await consumeStream(
        readableStreamFromIterable([1, 2, 3]).pipeThrough(tx),
      ),
      {
        chunks: ["start chunk", "1", "2", "3", "flush chunk"],
        end: { type: "close" },
      },
    );
  });
});

comparisonCases.forEach(({ createStream, label }) => {
  Deno.test(`${label} does not flush when the readable side is cancelled`, async () => {
    const error = new Error("example");
    const tx = createStream({
      transformer: {
        start(controller) {
          controller.enqueue("start chunk");
        },
        transform(chunk, controller) {
          controller.enqueue(`${chunk}`);
        },
        flush() {
          unreachable();
        },
      },
    });
    const reader = tx.readable.getReader();
    const writer = tx.writable.getWriter();
    assertEquals(await reader.read(), { done: false, value: "start chunk" });
    await Promise.all([
      () => writer.write(1),
      async () =>
        assertEquals(await reader.read(), { done: false, value: "1" }),
    ]);
    await reader.cancel(error);
    await assertRejects(
      () => writer.closed,
      (err: unknown) => assertEquals(err, error),
    );
  });
});

comparisonCases.forEach(({ createStream, label }) => {
  Deno.test(`${label} does not flush when the writable side is aborted`, async () => {
    const error = new Error("example");
    const tx = createStream({
      transformer: {
        start(controller) {
          controller.enqueue("start chunk");
        },
        transform(chunk, controller) {
          controller.enqueue(`${chunk}`);
        },
        flush() {
          unreachable();
        },
      },
    });
    const reader = tx.readable.getReader();
    const writer = tx.writable.getWriter();
    assertEquals(await reader.read(), { done: false, value: "start chunk" });
    await Promise.all([
      () => writer.write(1),
      async () =>
        assertEquals(await reader.read(), { done: false, value: "1" }),
    ]);
    await writer.abort(error);
    await assertRejects(
      () => writer.closed,
      (err: unknown) => assertEquals(err, error),
    );
    await assertRejects(
      () => reader.closed,
      (err: unknown) => assertEquals(err, error),
    );
  });
});

const exampleError = () => new Error("example");
const erroringTransformerCases: ReadonlyArray<
  { label: string; failedCall: string; transformer: Transformer }
> = [
  {
    label: "throws from start()",
    failedCall: "constructor",
    transformer: {
      start() {
        throw exampleError();
      },
    },
  },
  {
    label: "returns rejected promise from start() ",
    failedCall: "write()",
    transformer: {
      // deno-lint-ignore require-await
      async start() {
        throw exampleError();
      },
    },
  },
  {
    label: "throws from transform()",
    failedCall: "write()",
    transformer: {
      transform() {
        throw exampleError();
      },
    },
  },
  {
    label: "throws from flush()",
    failedCall: "close()",
    transformer: {
      flush() {
        throw exampleError();
      },
    },
  },
  {
    label: "calls controller.error()",
    failedCall: "close()",
    transformer: {
      transform(_chunk, controller) {
        // fails in the close() call as transform() itself doesn't throw
        controller.error(exampleError());
      },
    },
  },
];

comparisonCases.forEach(({ createStream, label }) => {
  erroringTransformerCases.forEach(
    ({ transformer, failedCall, label: transformerLabel }) => {
      Deno.test(`${label} becomes errored when Transformer ${transformerLabel}`, async () => {
        const scenario = async () => {
          // deno-lint-ignore require-await
          const tx = await (async () => createStream({ transformer }))()
            .catch((e) => {
              throw new Error("constructor", { cause: e });
            });
          const writer = tx.writable.getWriter();
          const ops = [
            writer.write("foo").catch((e) => {
              throw new Error("write()", { cause: e });
            }),
            writer.close().catch((e) => {
              throw new Error("close()", { cause: e });
            }),
            ,
            consumeStream(tx.readable),
          ];
          // await Promise.allSettled(ops.map((op) => op.catch(() => {})));
          await Promise.allSettled(ops);
          await Promise.all(ops); // reject with the first error
        };

        await assertRejects(
          scenario,
          (err: unknown) =>
            assertErrorEquals(
              err,
              new Error(failedCall, { cause: exampleError() }),
            ),
        );
      });
    },
  );
});

const transformCases: ReadonlyArray<
  { label: string; transform: Transformer["transform"] }
> = [
  { label: "undefined no-op transform", transform: undefined },
  {
    label: "explicit no-op transform",
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  },
];

comparisonCases.forEach(({ createStream, label }) => {
  transformCases.forEach(({ transform, label: transformLabel }) => {
    for (const readableCapacity of [1, 10, 20]) {
      for (const writableCapacity of [1, 10, 20]) {
        Deno.test(
          `${label} respects backpressure using ${transformLabel} transform (readableCapacity: ${readableCapacity}, writableCapacity: ${writableCapacity})`,
          async () => {
            const expectedPipelineCapacity = 1 + writableCapacity +
              readableCapacity;
            let pullCount = 0;
            const src = new ReadableStream({
              pull(controller) {
                assert(pullCount < 1000);
                pullCount++;
                return controller.enqueue(42);
              },
            });
            const dest = src.pipeThrough(createStream({
              transformer: { transform },
              writableStrategy: { highWaterMark: writableCapacity },
              readableStrategy: { highWaterMark: readableCapacity },
            }));
            await delay(0);
            // The pipeline will now be full to capacity with 0 chunks read
            assertEquals(pullCount, expectedPipelineCapacity);

            const reader = dest.getReader();
            for (let i = 0; i < 10; ++i) reader.read();
            await delay(0);
            assertEquals(pullCount, 10 + expectedPipelineCapacity);
          },
        );
      }
    }
  });
});

Deno.test("close() is called after sync flush() when stream closes normally", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      flush() {
        events.push("flush()");
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.all([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["flush()", "close()"]);
});

Deno.test("close() is called after async flush() when stream closes normally", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      async flush() {
        events.push("flush() start");
        await delay(0);
        events.push("flush() end");
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.all([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["flush() start", "flush() end", "close()"]);
});

Deno.test("close() is called after sync flush() throws", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      flush() {
        events.push("flush() threw");
        throw new Error("flush() failed");
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["flush() threw", "close()"]);
});

Deno.test("close() is called after sync flush() calls controller.error()", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      flush(controller) {
        events.push("flush() calls controller.error()");
        controller.error(new Error("flush() failed"));
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["flush() calls controller.error()", "close()"]);
});

Deno.test("close() is called after async flush() rejects", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      async flush() {
        events.push("flush() start");
        await delay(0);
        events.push("flush() failed");
        throw new Error("flush() failed");
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["flush() start", "flush() failed", "close()"]);
});

Deno.test("close() is called after async flush() resolves and calls controller.error()", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      async flush(controller) {
        events.push("flush() start");
        await delay(0);
        events.push("flush() calls controller.error()");
        controller.error(new Error("flush() failed"));
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([
    tx.writable.getWriter().close(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, [
    "flush() start",
    "flush() calls controller.error()",
    "close()",
  ]);
});

Deno.test("close() is called after start() rejects", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      // deno-lint-ignore require-await
      async start() {
        events.push("start()");
        throw new Error("start() failed");
      },
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([tx.readable.getReader().closed]);
  assertEquals(events, ["start()", "close()"]);
});

Deno.test("close() is called after the stream is aborted", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      close() {
        events.push("close()");
      },
    },
  });
  await Promise.allSettled([
    tx.writable.getWriter().abort(),
    tx.readable.getReader().closed,
  ]);
  assertEquals(events, ["close()"]);
});

Deno.test("close() is called after the stream is cancelled", async () => {
  const events: string[] = [];
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      close() {
        events.push("close()");
      },
    },
  });
  const reader = tx.readable.getReader();
  await Promise.allSettled([
    reader.cancel(),
    reader.closed,
    tx.writable.getWriter().closed,
  ]);
  assertEquals(events, ["close()"]);
});

Deno.test("abort signal triggers after the readable side is cancelled", async () => {
  const events: string[] = [];
  const error = new Error("example");
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      start(controller) {
        controller.signal.addEventListener("abort", () => {
          events.push("abort signal");
        });
      },
    },
  });
  const reader = tx.readable.getReader();
  await Promise.all([
    reader.cancel(error),
    reader.closed,
    assertRejects(
      () => tx.writable.getWriter().closed,
      (err: unknown) => assertErrorEquals(err, error),
    ),
  ]);
  assertEquals(events, ["abort signal"]);
});

Deno.test("abort signal triggers after the stream throws during use", async () => {
  const events: string[] = [];
  const error = new Error("example");
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      start(controller) {
        controller.signal.addEventListener("abort", () => {
          events.push("abort signal");
        });
      },
      transform() {
        events.push("transform()");
        throw error;
      },
    },
  });
  await Promise.all([
    assertRejects(
      () => tx.writable.getWriter().write("foo"),
      (err: unknown) => assertErrorEquals(err, error),
    ),
    assertRejects(
      () => tx.readable.getReader().read(),
      (err: unknown) => assertErrorEquals(err, error),
    ),
  ]);
  assertEquals(events, ["transform()", "abort signal"]);
});

Deno.test("abort signal triggers after the writable side is aborted", async () => {
  const events: string[] = [];
  const error = new Error("example");
  const tx = new ShutdownAwareTransformStream({
    transformer: {
      start(controller) {
        controller.signal.addEventListener("abort", () => {
          events.push("abort signal");
        });
      },
    },
  });
  await Promise.all([
    tx.writable.getWriter().abort(error),
    assertRejects(
      () => tx.readable.getReader().read(),
      (err: unknown) => assertErrorEquals(err, error),
    ),
  ]);
  assertEquals(events, ["abort signal"]);
});
