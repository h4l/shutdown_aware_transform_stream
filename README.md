# `shutdown_aware_transform_stream`

A [Deno] module providing `ShutdownAwareTransformStream`: an augmented
[Web Streams] `TransformStream` that enables Transformers holding resources
requiring explicit cleanup to automatically perform cleanup steps when the
stream either closes succesfully, or aborts with an error.

The standard `TransformStream` only informs its Transformer of the stream
shutting down at end of input via the `flush()` method; it does not inform
Transformers of the stream becoming aborted.

[Web Streams]: https://developer.mozilla.org/en-US/docs/Web/API/Streams_API
[Deno]: https://deno.land/

## Usage

`ShutdownAwareTransformStream` is used like a regular [`TransformStream`] except
that the `Transformer` can have an `close()` method that's called once when the
stream has closed at end of input, or has aborted due to an error.

Also `controller.signal` is an `AbortSignal` that triggers when the stream is
aborted. (`WritableStream` Controllers also provide this, but standard
`TransformStreams` do not.)

[`TransformStream`]: https://developer.mozilla.org/en-US/docs/Web/API/TransformStream

```ts
// from examples/simple.ts
import {
  ShutdownAwareTransformStream,
} from "https://deno.land/x/shutdown_aware_transform_stream@1.0.0/mod.ts";

const transform = new ShutdownAwareTransformStream<number, string>({
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

someStream.pipeThrough(transform).pipeTo(otherStream);
```

The [examples](./examples) directory contains complete examples:.

```console
$ deno run --quiet --import-map import_map.json examples/simple.ts
Using transform in a stream pipeline that ends with an error:
* dest: write(transform(1))
* dest: write(transform(2))
* dest: write(transform(3))
* dest: write(transform(4))
* dest: write(transform(5))
* dest: throwing error ...
ShutdownAwareTransformer: close() called
Pipeline failed: Error: error from dest


Using transform in a stream pipeline that ends normally:
* dest: write(transform(1))
* dest: write(transform(2))
* dest: write(transform(3))
* dest: write(transform(4))
* dest: write(transform(5))
ShutdownAwareTransformer: flush() called
ShutdownAwareTransformer: close() called
Pipeline completed normally
```

The module is available from
[deno.land](https://deno.land/x/shutdown_aware_transform_stream):

```ts
import {
  ShutdownAwareTransformStream,
} from "https://deno.land/x/shutdown_aware_transform_stream@unpublished/mod.ts";
import type {
  ShutdownAwareTransformer,
  ShutdownAwareTransformStreamController,
  ShutdownAwareTransformStreamOptions,
} from "https://deno.land/x/shutdown_aware_transform_stream@unpublished/mod.ts";
```

## Roadmap

- [ ] Publish on deno.land

## Contributing

Pull requests are welcome. For major changes, please open an issue first to
discuss what you would like to change.

Please make sure to update tests as appropriate.

## License

[MIT](https://choosealicense.com/licenses/mit/)
