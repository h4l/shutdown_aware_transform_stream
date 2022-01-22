/** An example of ShutdownAwareTransformStream that uses the `controller.signal`
 * AbortSignal to react to the error that aborts the stream.
 *
 * `close()` is called when the stream closes normally or aborts. The
 * `AbortSignal` only triggers when hte stream aborts.
 */
import {
  ShutdownAwareTransformStream,
} from "https://deno.land/x/shutdown_aware_transform_stream@unpublished/mod.ts";
import { runExamples } from "./_example_runner.ts";

function createExampleTransform() {
  let signal: AbortSignal | undefined;
  return new ShutdownAwareTransformStream<number, string>({
    transformer: {
      start(controller) {
        signal = controller.signal;
        signal.addEventListener("abort", () =>
          console.log(
            "ShutdownAwareTransformer: abort event received, reason: " +
              controller.signal.reason,
          ));
      },
      close() {
        // The signal can tell us if the stream aborted or closed normally
        if (signal?.aborted) {
          console.log(
            "* ShutdownAwareTransformStream: close() called due to stream aborting\n" +
              `  reason: ${signal.reason}`,
          );
        } else {
          console.log(
            "* ShutdownAwareTransformStream: close() called due to end of input",
          );
        }
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
