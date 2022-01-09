import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
  deferred,
  delay,
} from "./dev_deps.ts";
import { ShutdownMonitorWritableStream } from "./shutdown_monitor_writable_stream.ts";
import { assertErrorEquals, consumeStream } from "./_test_utils.ts";

function pipeBeforeOrAfterActionFn(
  beforeOrAfter: "before" | "after",
) {
  return function pipeBeforeOrAfterAction<T = void>(options: {
    monitor: ShutdownMonitorWritableStream;
    destination: WritableStream | TransformStream;
  }, action: () => T): T {
    const destWritable =
      (options.destination as Partial<TransformStream>).writable ||
      (options.destination as WritableStream);
    if (beforeOrAfter === "after") options.monitor.pipeTo(destWritable);
    const result = action();
    if (beforeOrAfter === "before") options.monitor.pipeTo(destWritable);
    return result;
  };
}

for (const beforeOrAfter of ["before", "after"] as const) {
  const pipeBeforeOrAfterAction = pipeBeforeOrAfterActionFn(beforeOrAfter);

  Deno.test(`chunks written to monitor ${beforeOrAfter} pipeTo() are written to destination`, async () => {
    const monitor = new ShutdownMonitorWritableStream();
    const destination = new TransformStream();
    const monitorWriter = monitor.getWriter();

    pipeBeforeOrAfterAction({ monitor, destination }, () => {
      for (const chunk of ["a", "b", "c"]) monitorWriter.write(chunk);
      monitorWriter.close();
    });

    assertEquals(await consumeStream(destination.readable), {
      chunks: ["a", "b", "c"],
      end: { type: "close" },
    });
  });

  Deno.test(`aborting the monitor ${beforeOrAfter} pipeTo() aborts the destination`, async () => {
    const reason = new Error("example");
    const monitor = new ShutdownMonitorWritableStream();
    const destinationAborted = deferred<AbortSignal>();
    const destination = new WritableStream({
      start(controller) {
        destinationAborted.resolve(controller.signal);
      },
    });

    await pipeBeforeOrAfterAction({ monitor, destination }, () => {
      return monitor.abort(reason);
    });

    assertErrorEquals((await destinationAborted).reason, reason);
  });

  Deno.test(`aborting the destination ${beforeOrAfter} pipeTo() aborts the monitor`, async () => {
    const reason = new Error("example");
    const monitor = new ShutdownMonitorWritableStream();
    let destController: TransformStreamDefaultController | undefined =
      undefined;
    const destination = new TransformStream({
      start(controller) {
        destController = controller;
      },
    });

    pipeBeforeOrAfterAction({ monitor, destination }, () => {
      destController?.error(reason);
    });

    await assertRejects(
      () => monitor.getWriter().closed,
      (err: unknown) => assertErrorEquals(err, reason),
    );
  });

  Deno.test("abort() throws when dest's abort fails", async () => {
    const reason = new Error("example");
    const destAbortFailure = new Error("abort failed");
    const monitor = new ShutdownMonitorWritableStream();
    const monitorWriter = monitor.getWriter();
    const destination = new WritableStream({
      abort(receivedReason: unknown) {
        assertErrorEquals(receivedReason, reason);
        throw destAbortFailure;
      },
    });
    const destClosed = monitor.pipeTo(destination);
    await assertRejects(
      () => monitorWriter.abort(reason),
      (err: unknown) => assertErrorEquals(err, destAbortFailure),
    );
    await assertRejects(
      () => monitorWriter.closed,
      (err: unknown) => assertErrorEquals(err, reason),
    );
    await assertRejects(
      () => destClosed,
      (err: unknown) => assertErrorEquals(err, reason),
    );
  });
}

Deno.test("pipeTo() fails when destination is locked", () => {
  const monitor = new ShutdownMonitorWritableStream();
  const dest = new WritableStream();
  dest.getWriter(); // lock dest
  assertThrows(
    () => monitor.pipeTo(dest),
    TypeError,
    "The stream is already locked.",
  );
});

Deno.test("pipeTo() fails when pipeTo() has already been used", () => {
  const monitor = new ShutdownMonitorWritableStream();
  const dest = new WritableStream();
  monitor.pipeTo(dest);
  assertThrows(
    () => monitor.pipeTo(dest),
    TypeError,
    "Failed to pipeTo destination: this stream is already pipedTo a destination",
  );
});

Deno.test("pipeTo() aborts destination when the monitor is already errored", async () => {
  let asyncAsserts = 0;
  const error = new Error("example");
  const monitor = new ShutdownMonitorWritableStream();
  const monitorWriter = monitor.getWriter();
  monitorWriter.abort(error);
  const destination = new WritableStream({
    abort(reason) {
      assertErrorEquals(reason, error);
      asyncAsserts++;
    },
  });
  await assertRejects(
    () => monitor.pipeTo(destination),
    (err: unknown) => assertErrorEquals(err, error),
  );
  assertEquals(asyncAsserts, 1);
});

for (const readableCapacity of [1, 10, 20]) {
  for (const writableCapacity of [1, 10, 20]) {
    Deno.test(`pipeTo() respects backpressure (readableCapacity: ${readableCapacity}, writableCapacity: ${writableCapacity})`, async () => {
      let pullCount = 0;
      const src = new ReadableStream({
        pull(controller) {
          assert(pullCount < 1000);
          pullCount++;
          return controller.enqueue(42);
        },
      });
      const monitor = new ShutdownMonitorWritableStream({
        queuingStrategy: { highWaterMark: writableCapacity },
      });
      const dest = new TransformStream(
        undefined,
        // Note that the queue of the monitored writable is never populated
        // because of the way the monitor proxies the monitored stream's write()
        // method. (See the comment in ShutdownMonitorWritableStream's
        // UnderlyingSink write() method.)
        { highWaterMark: 9999 /* large value that won't actually be used */ },
        { highWaterMark: readableCapacity },
      );
      monitor.pipeTo(dest.writable);
      src.pipeThrough({ writable: monitor, readable: dest.readable });
      await delay(0);
      // 1 for src + the dest's combined capacity (the writable side queue of
      // the internal transform stream is not populated)
      assertEquals(pullCount, 1 + writableCapacity + readableCapacity);

      const reader = dest.readable.getReader();
      for (let i = 0; i < 10; ++i) reader.read();
      await delay(0);
      assertEquals(pullCount, 10 + 1 + writableCapacity + readableCapacity);
    });
  }
}

Deno.test("The promise returned from pipeTo()'s resolves when the destination closes", async () => {
  let destClosed = false;
  const monitor = new ShutdownMonitorWritableStream();
  const monitorWriter = monitor.getWriter();
  const dest = new WritableStream({
    close() {
      destClosed = true;
    },
  });
  const pipe = monitor.pipeTo(dest);
  // pipe doesn't resolve before dest is closed/errored
  assertEquals(
    await Promise.race([pipe.then(() => Promise.reject()), delay(0)]),
    undefined,
  );
  assert(!destClosed);
  assertEquals(await Promise.all([monitorWriter.close(), pipe]), [
    undefined,
    undefined,
  ]);
  assert(destClosed);
});

Deno.test("The promise returned from pipeTo()'s rejects when the destination aborts", async () => {
  const monitor = new ShutdownMonitorWritableStream();
  const dest = new WritableStream();
  const pipe = monitor.pipeTo(dest);
  // pipe doesn't resolve before dest is closed/errored
  assertEquals(
    await Promise.race([pipe.then(() => Promise.reject()), delay(0)]),
    undefined,
  );
  assertEquals(
    await Promise.race([
      Promise.all([
        monitor.getWriter().abort(new Error("example")),
        pipe.catch((e) => e),
      ]),
      delay(0).then(() => Promise.reject("pipe did not abort")),
    ]),
    [undefined, new Error("example")],
  );
});

Deno.test("The monitor's write() rejects when the destination's write fails", async () => {
  const thrownErr = new Error("example");
  const monitor = new ShutdownMonitorWritableStream();
  const dest = new WritableStream({
    write() {
      throw thrownErr;
    },
  });
  monitor.pipeTo(dest);
  const writer = monitor.getWriter();
  await assertRejects(
    () => writer.write("foo"),
    (err: unknown) => assertErrorEquals(err, thrownErr),
  );
});
