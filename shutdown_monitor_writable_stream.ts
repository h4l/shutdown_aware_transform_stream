import {
  Deferred,
  deferred,
} from "https://deno.land/std@0.119.0/async/deferred.ts";
import { assert } from "./deps.ts";

export class ShutdownMonitorWritableStream<W = unknown>
  extends WritableStream<W> {
  readonly #monitoredWritable: Deferred<WritableStream<W>>;
  #monitoredWriter: WritableStreamDefaultWriter<W> | undefined;
  constructor() {
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
      write: async (chunk: W) => {
        assert(this.#monitoredWriter);
        await this.#monitoredWriter!.ready;
        this.#monitoredWriter!.write(chunk);
      },
    });
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
