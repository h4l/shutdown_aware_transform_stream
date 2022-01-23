/** An example transform stream that reacts to the stream shutting down, both
 * when end-of-input is reached, or the stream aborts with an error.
 */
import {
  ShutdownAwareTransformStream,
} from "https://deno.land/x/shutdown_aware_transform_stream@1.0.0/mod.ts";
import { runExamples } from "./_example_runner.ts";

function createExampleTransform() {
  return new ShutdownAwareTransformStream<number, string>({
    transformer: {
      close() {
        console.log(`ShutdownAwareTransformer: close() called`);
      },
      transform(chunk, controller) {
        controller.enqueue(`transform(${chunk})`);
      },
      flush() {
        console.log(`ShutdownAwareTransformer: flush() called`);
      },
    },
  });
}

await runExamples({ createExampleTransform });
