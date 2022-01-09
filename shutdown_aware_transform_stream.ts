import { assert } from "./deps.ts";
import { ShutdownMonitorWritableStream } from "./shutdown_monitor_writable_stream.ts";

export interface ShutdownAwareTransformStreamController<O = unknown>
  extends TransformStreamDefaultController<O> {
  readonly signal: AbortSignal;
}

export interface ShutdownAwareTransformer<I = unknown, O = unknown> {
  readableType?: never;
  writableType?: never;
  start?: (
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  flush?: (
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  transform?: (
    chunk: I,
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  close?: () => void;
}

export interface ShutdownAwareTransformStreamOptions<I = unknown, O = unknown> {
  transformer?: ShutdownAwareTransformer<I, O>;
  writableStrategy?: QueuingStrategy<I>;
  readableStrategy?: QueuingStrategy<O>;
}

export class ShutdownAwareTransformStream<I = unknown, O = unknown>
  implements TransformStream<I, O> {
  readonly #monitor: ShutdownMonitorWritableStream<I>;
  readonly #abortController: AbortController;
  readonly #transformer: ShutdownAwareTransformerAdapter<I, O>;
  readonly #transformStream: TransformStream<I, O>;
  readonly #transformMonitorPipe: Promise<void>;
  constructor(options: ShutdownAwareTransformStreamOptions<I, O> = {}) {
    this.#monitor = new ShutdownMonitorWritableStream({
      queuingStrategy: options.writableStrategy,
    });
    this.#abortController = new AbortController();
    this.#transformer = new ShutdownAwareTransformerAdapter<I, O>(
      this.#abortController.signal,
      options.transformer ?? {},
    );
    this.#transformStream = new TransformStream<I, O>(
      this.#transformer,
      undefined,
      options.readableStrategy,
    );
    this.#transformMonitorPipe = this.#monitor.pipeTo(
      this.#transformStream.writable,
    );
    this.#transformMonitorPipe.catch((reason) => {
      this.#abortController.abort(reason);
    });
  }
  get readable(): ReadableStream<O> {
    return this.#transformStream.readable;
  }
  get writable(): WritableStream<I> {
    return this.#monitor;
  }
}

class ShutdownAwareTransformStreamDefaultController<O>
  implements ShutdownAwareTransformStreamController<O> {
  constructor(
    readonly signal: AbortSignal,
    private readonly controller: TransformStreamDefaultController<O>,
  ) {}
  get desiredSize(): number | null {
    return this.controller.desiredSize;
  }
  enqueue(chunk: O) {
    this.controller.enqueue(chunk);
  }
  error(reason?: unknown) {
    this.controller.error(reason);
  }
  terminate() {
    this.controller.terminate();
  }
}

class ShutdownAwareTransformerAdapter<I, O> implements Transformer<I, O> {
  #wrappedController: undefined | TransformStreamDefaultController<O> =
    undefined;
  #controller: undefined | ShutdownAwareTransformStreamController<O> = undefined;
  readonly transform: Transformer<I, O>["transform"];
  constructor(
    readonly signal: AbortSignal,
    readonly transformer: ShutdownAwareTransformer<I, O>,
  ) {
    if (transformer.close) {
      signal.addEventListener("abort", transformer.close.bind(transformer));
    }
    // In order to inherit the no-op transform behaviour of TransformStream,
    // only define transform() if the wrapped transformer does.
    if (transformer.transform) {
      const transform = transformer.transform.bind(transformer);
      this.transform = (
        chunk: I,
        _controller: TransformStreamDefaultController<O>,
      ): void | PromiseLike<void> => {
        assert(_controller === this.#wrappedController);
        assert(this.#controller);
        return transform(chunk, this.#controller!);
      };
    }
  }

  start(
    controller: TransformStreamDefaultController<O>,
  ): void | PromiseLike<void> {
    this.#wrappedController = controller;
    this.#controller = new ShutdownAwareTransformStreamDefaultController<O>(
      this.signal,
      controller,
    );
    return this.transformer.start && this.transformer.start(this!.#controller);
  }
  flush(
    _controller: TransformStreamDefaultController<O>,
  ): void | PromiseLike<void> {
    assert(_controller === this.#wrappedController);
    assert(this.#controller);
    return Promise.resolve(
      this.transformer.flush && this.transformer.flush(this.#controller!),
    ).finally(
      this.transformer.close && this.transformer.close.bind(this.transformer),
    );
  }
}
