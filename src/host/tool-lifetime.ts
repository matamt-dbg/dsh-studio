/** Abort and join all work owned by one agent's experiment snapshot. */
export function createLifetime() {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  return {
    signal: controller.signal,
    run<T>(body: (signal: AbortSignal) => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      const promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return body(controller.signal); });
      pending.add(promise);
      void promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    dispose(): Promise<void> {
      if (closing) return closing;
      controller.abort(new Error('Studio tool scope disposed'));
      closing = Promise.allSettled([...pending]).then(() => {});
      return closing;
    },
  };
}
/** Work owner shared by nested calls and detached tasks. */
export type Lifetime = ReturnType<typeof createLifetime>;
