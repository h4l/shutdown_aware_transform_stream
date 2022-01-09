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
