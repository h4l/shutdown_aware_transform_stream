export async function runExamples({ createExampleTransform }: {
  createExampleTransform: () => TransformStream<number, string>;
}): Promise<void> {
  console.log("Using transform in a stream pipeline that ends with an error:");
  await runExample({ exampleTransform: createExampleTransform(), fail: true });

  console.log("\n\nUsing transform in a stream pipeline that ends normally:");
  await runExample({ exampleTransform: createExampleTransform(), fail: false });
}

export async function runExample(
  options: {
    exampleTransform: TransformStream<number, string>;
    fail: boolean;
  },
): Promise<void> {
  const chunkCount = 5;

  const source = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < chunkCount; ++i) {
        controller.enqueue(i + 1);
        await delay(100);
      }
      controller.close();
    },
  });

  let chunksSeen = 0;
  const dest = new WritableStream({
    write(chunk) {
      console.log(`* dest: write(${chunk})`);
      chunksSeen++;
      if (options.fail && chunksSeen === chunkCount) {
        console.log(`* dest: throwing error ...`);
        throw new Error(`error from dest`);
      }
    },
  });

  try {
    await source.pipeThrough(options.exampleTransform).pipeTo(dest);
    console.log(
      "Pipeline completed normally",
    );
  } catch (err) {
    console.log(`Pipeline failed: ${err}`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
