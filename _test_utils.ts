// Copyright 2021 Hal Blackburn. All rights reserved. MIT license.
export type CloseEvent = { type: "close" };
export type AbortEvent = { type: "abort"; reason: unknown };
export type ConsumedStreamEvents<T> = {
  chunks: ReadonlyArray<T>;
  end: CloseEvent | AbortEvent;
};

export async function consumeStream<T>(
  stream: ReadableStream<T>,
): Promise<ConsumedStreamEvents<T>> {
  const chunks: T[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (reason: unknown) {
    return { chunks, end: { type: "abort", reason } };
  }
  return { chunks, end: { type: "close" } };
}
