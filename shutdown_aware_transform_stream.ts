// Copyright 2021-2022 Hal Blackburn. All rights reserved. MIT license.
import { assert } from "./deps.ts";
import { ShutdownMonitorWritableStream } from "./shutdown_monitor_writable_stream.ts";

/** Used by a `ShutdownAwareTransformer` to interact with its stream.
 *
 * It behaves in the same way as a normal `TransformStream` Controller, except
 * that it has a `signal` property. `signal` is an `AbortSignal` that triggers
 * when the underlying stream is aborted.
 *
 * * https://streams.spec.whatwg.org/#transformer-api
 * * https://developer.mozilla.org/en-US/docs/Web/API/TransformStreamDefaultController
 * * This API mirrors the Controller of `WritableStream`, which also exposes a
 *   `signal` property: https://streams.spec.whatwg.org/#writablestreamdefaultcontroller
 */
export interface ShutdownAwareTransformStreamController<O = unknown>
  extends TransformStreamDefaultController<O> {
  readonly signal: AbortSignal;
}

/** An object that defines the behaviour of a `ShutdownAwareTransformStream`.
 *
 * It behaves in the same way as a normal `TransformStream` Transformer,
 * except that it can have a `close()` method, and the Controller received by
 * its methods is a `ShutdownAwareTransformStreamController`.
 *
 * * https://streams.spec.whatwg.org/#transformer-api
 * * https://developer.mozilla.org/en-US/docs/Web/API/TransformStream/TransformStream
 */
export interface ShutdownAwareTransformer<I = unknown, O = unknown> {
  readableType?: never;
  writableType?: never;
  /** Called when the stream is created, before any other Transformer methods. */
  start?: (
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  /** Called after the final chunk has been processed by `transform()`. */
  flush?: (
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  /** Called with each chunk passing through the stream. */
  transform?: (
    chunk: I,
    controller: ShutdownAwareTransformStreamController<O>,
  ) => void | PromiseLike<void>;
  /** Called when the stream has shutdown, either due to an error or end-of-input.
   *
   * Never called more than once, even if an error occurs as the stream closes
   * from end-of-input. To distinguish between end-of-input and stream errors,
   * `controller.signal.aborted` will be true when an error occured, and
   * `controller.signal.reason` will be the error.
   */
  close?: () => void;
}

/** Constructor options for `ShutdownAwareTransformStream`. */
export interface ShutdownAwareTransformStreamOptions<I = unknown, O = unknown> {
  /** The Transformer object defining the stream's behaviour. */
  transformer?: ShutdownAwareTransformer<I, O>;
  /** The `QueuingStrategy` for the writable side of the stream. */
  writableStrategy?: QueuingStrategy<I>;
  /** The `QueuingStrategy` for the readable side of the stream. */
  readableStrategy?: QueuingStrategy<O>;
}

/**
 * A `TransformStream` that allows its Transformer to be notified when the
 * stream has shutdown, either due to an error or from end-of-input.
 *
 * The standard `TransformStream` does not support notifying its Transformer
 * if the stream encounters an error.
 *
 * To be notified of stream shutdown, either provide a `close()` method on the
 * Transformer object, or register a listener on the Controller's `signal`
 * property (an [`AbortSignal`]) in the Transformer's `start()` method:
 *
 * [`AbortSignal`]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
 *
 * ```typescript
 * new ShutdownAwareTransformStream({
 *   transformer: {
 *     start(controller) {
 *       controller.signal.addEventListener(
 *         "abort",
 *         () => console.log("stream aborted"),
 *       );
 *     },
 *     close() {
 *       console.log("stream has shutdown");
 *     },
 *     transform(chunk, controller) {
 *       // ...
 *     },
 *   },
 * });
 * ```
 */
export class ShutdownAwareTransformStream<I = unknown, O = unknown>
  implements TransformStream<I, O> {
  readonly #monitor: ShutdownMonitorWritableStream<I>;
  readonly #abortController: AbortController;
  readonly #transformer: ShutdownAwareTransformerAdapter<I, O>;
  readonly #transformStream: TransformStream<I, O>;
  readonly #transformMonitorPipe: Promise<void>;
  /** Note that arguments are passed as an object rather than individually
   * (unlike a standard `TransformStream`).
   */
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
  #signal: AbortSignal;
  #transformer: ShutdownAwareTransformer<I, O>;
  #wrappedController: undefined | TransformStreamDefaultController<O> =
    undefined;
  #controller: undefined | ShutdownAwareTransformStreamController<O> =
    undefined;
  readonly transform: Transformer<I, O>["transform"];
  #closeTransformerIfNotAlreadyClosed = (() => {
    let closeCalled = false;
    return () => {
      if (!closeCalled) {
        closeCalled = true;
        this.#transformer.close && this.#transformer.close();
      }
    };
  })();
  constructor(
    signal: AbortSignal,
    transformer: ShutdownAwareTransformer<I, O>,
  ) {
    this.#signal = signal;
    this.#transformer = transformer;
    signal.addEventListener("abort", this.#closeTransformerIfNotAlreadyClosed);
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
      this.#signal,
      controller,
    );
    return this.#transformer.start && this.#transformer.start(this.#controller);
  }
  flush(
    _controller: TransformStreamDefaultController<O>,
  ): void | PromiseLike<void> {
    assert(_controller === this.#wrappedController);
    assert(this.#controller);
    // If flush() throws synchronously, the stream errors and close() is called
    // via this.#signal. Note that if flush calls controller.error() and returns
    // synchronously then close() will be called before the underlying transform
    // stream becomes errored.
    return Promise.resolve(
      this.#transformer.flush && this.#transformer.flush(this.#controller!),
    ).then(this.#closeTransformerIfNotAlreadyClosed);
  }
}
