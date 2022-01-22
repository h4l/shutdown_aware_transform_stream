// Copyright 2021-2022 Hal Blackburn. All rights reserved. MIT license.
import { assert, assertEquals, readAll } from "./dev_deps.ts";

Deno.test({
  name: "resource_closing example",
  fn: async () => {
    const { stdout, stderr, exitStatus } = await runExample(
      "resource_closing.ts",
    );
    assertEquals(exitStatus, 0);
    assertEquals(
      stdout,
      `\
Using transform in a stream pipeline that ends with an error:
* dest: write(ExampleResource.performAction(1))
* dest: write(ExampleResource.performAction(2))
* dest: write(ExampleResource.performAction(3))
* dest: write(ExampleResource.performAction(4))
* dest: write(ExampleResource.performAction(5))
* dest: throwing error ...
* ExampleResource: closed
Pipeline failed: Error: error from dest


Using transform in a stream pipeline that ends normally:
* dest: write(ExampleResource.performAction(1))
* dest: write(ExampleResource.performAction(2))
* dest: write(ExampleResource.performAction(3))
* dest: write(ExampleResource.performAction(4))
* dest: write(ExampleResource.performAction(5))
* ExampleResource: closed
Pipeline completed normally
`,
    );
    assertEquals(stderr, "");
  },
});

Deno.test("simple example", async () => {
  const { stdout, stderr, exitStatus } = await runExample(
    "simple.ts",
  );
  assertEquals(exitStatus, 0);
  assertEquals(
    stdout,
    `\
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
`,
  );
  assertEquals(stderr, "");
});

Deno.test("abort_signal example", async () => {
  const { stdout, stderr, exitStatus } = await runExample(
    "abort_signal.ts",
  );
  assertEquals(exitStatus, 0);
  assertEquals(
    stdout,
    `\
Using transform in a stream pipeline that ends with an error:
* dest: write(transform(1))
* dest: write(transform(2))
* dest: write(transform(3))
* dest: write(transform(4))
* dest: write(transform(5))
* dest: throwing error ...
* ShutdownAwareTransformStream: close() called due to stream aborting
  reason: Error: error from dest
ShutdownAwareTransformer: abort event received, reason: Error: error from dest
Pipeline failed: Error: error from dest


Using transform in a stream pipeline that ends normally:
* dest: write(transform(1))
* dest: write(transform(2))
* dest: write(transform(3))
* dest: write(transform(4))
* dest: write(transform(5))
ShutdownAwareTransformer: flush() called
* ShutdownAwareTransformStream: close() called due to end of input
Pipeline completed normally
`,
  );
  assertEquals(stderr, "");
});

async function readAllUtf8(reader: Deno.Reader & Deno.Closer): Promise<string> {
  return new TextDecoder().decode(await readAll(reader));
}

interface ExecutedExample {
  stdout: string;
  stderr: string;
  exitStatus: number;
}
async function runExample(exampleName: string): Promise<ExecutedExample> {
  let proc: Deno.Process | undefined = undefined;
  try {
    proc = Deno.run({
      cmd: [
        "deno",
        "run",
        "--quiet",
        "--import-map",
        "import_map.json",
        `examples/${exampleName}`,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    assert(proc.stdout !== null);
    assert(proc.stderr !== null);
    const stdout = await readAllUtf8(proc.stdout);
    const stderr = await readAllUtf8(proc.stderr);
    const exitStatus = await (await proc.status()).code;
    return { stdout, stderr, exitStatus };
  } finally {
    if (proc) {
      proc.stdout?.close();
      proc.stderr?.close();
      proc.close();
    }
  }
}
