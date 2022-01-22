/** An example of a transform stream that holds a resource that needs to be
 * explicitly closed when the stream stops.
 */
import {
  ShutdownAwareTransformStream,
} from "https://deno.land/x/shutdown_aware_transform_stream@unpublished/mod.ts";
import { runExamples } from "./_example_runner.ts";

/** A resource that needs to be closed after use. */
class ExampleResource {
  performAction(thing: number): string {
    return `ExampleResource.performAction(${thing})`;
  }
  close() {
    console.log("* ExampleResource: closed");
  }
}

/** A TransformStream that needs to `close()` the `ExampleResource` it uses. */
class ExampleResourceTransformStream
  implements TransformStream<number, string> {
  readonly readable: ReadableStream<string>;
  readonly writable: WritableStream<number>;
  readonly #resource: ExampleResource = new ExampleResource();
  constructor() {
    const transform = new ShutdownAwareTransformStream<number, string>({
      transformer: {
        transform: (chunk, controller) => {
          controller.enqueue(this.#resource.performAction(chunk));
        },
        close: () => {
          this.#resource.close();
        },
      },
    });
    this.readable = transform.readable;
    this.writable = transform.writable;
  }
}

await runExamples({
  createExampleTransform: () => new ExampleResourceTransformStream(),
});
