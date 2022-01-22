// Copyright 2021-2022 Hal Blackburn. All rights reserved. MIT license.
import {
  Deferred,
  deferred,
} from "https://deno.land/std@0.119.0/async/deferred.ts";
import { assert } from "./deps.ts";

type ShutdownMonitorWritableStreamOptions<W = unknown> = {
  queuingStrategy?: QueuingStrategy<W>;
};

export class ShutdownMonitorWritableStream<W = unknown>
  extends WritableStream<W> {
  readonly #monitoredWritable: Deferred<WritableStream<W>>;
  #monitoredWriter: WritableStreamDefaultWriter<W> | undefined;
  constructor(options?: ShutdownMonitorWritableStreamOptions<W>) {
    const monitoredWritable: Deferred<WritableStream<W>> = deferred();
    super({
      start: async (controller) => {
        await monitoredWritable;
        assert(this.#monitoredWriter);
        this.#monitoredWriter!.closed.catch(controller.error.bind(controller));
      },
      abort: (reason: unknown) => {
        assert(this.#monitoredWriter);
        return this.#monitoredWriter!.abort(reason);
      },
      close: () => {
        assert(this.#monitoredWriter);
        return this.#monitoredWriter!.close();
      },
      write: (chunk: W) => {
        assert(this.#monitoredWriter);
        // There's perhaps a surprising amount of nuance to returning (or not
        // returning) the promise from the monitored writer. There are basically
        // two choices. Either we:
        //   a: return it
        //   b: await this.#monitoredWriter.ready and then catch and ignore the
        //      promise from this.#monitoredWriter.write().
        // By taking option a we cause the chunk buffer/queue of the monitored
        // stream not to be used, because our queue will not begin executing a
        // write until the previous write's promise has resolved.
        // Normally when using a stream's writer, this would be undesirable, and
        // indeed the streams spec explicity warns against it:
        //   https://streams.spec.whatwg.org/#example-manual-write-dont-await
        // However, because we're explicitly proxying another stream, it is the
        // behaviour we want:
        //  - Unlike option b, it makes our write() reject when the monitored
        //    stream's write() rejects.
        //  - Because it nullifies the monitored stream's queue, introducing
        //    this additional wrapper stream in a pipelines does NOT result in
        //    additional queueing capacity being created in the pipeline. This
        //    doesn't matter in practice (unless the exact number of in-flight
        //    chunks really matters for some reason), but it does make the
        //    wrapper's presence transparent, which is nice.
        // A possible downside is that if the monitored stream does define a
        // queueing strategy, the strategy needs to be assigned to this monitor
        // queue for it to take effect.
        return this.#monitoredWriter!.write(chunk);
      },
    }, options && options.queuingStrategy);
    this.#monitoredWritable = monitoredWritable;
  }

  pipeTo(destination: WritableStream<W>): Promise<void> {
    if (this.#monitoredWriter !== undefined) {
      throw new TypeError(
        "Failed to pipeTo destination: this stream is already pipedTo a destination",
      );
    }
    this.#monitoredWriter = destination.getWriter();
    this.#monitoredWritable.resolve(destination);
    return this.#monitoredWriter.closed;
  }
}
