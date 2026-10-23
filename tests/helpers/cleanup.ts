export async function withCleanup<T>(action: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let result: T;
  try { result = await action(); }
  catch (primary) {
    try { await cleanup(); }
    catch (recovery) { throw new AggregateError([primary, recovery], 'Operation failed and recovery also failed.'); }
    throw primary;
  }
  await cleanup();
  return result;
}

export class CleanupRegistry {
  private tasks: { label: string; run: () => Promise<void>; done: boolean }[] = [];

  add(label: string, run: () => Promise<void>): () => Promise<void> {
    const task = { label, run, done: false };
    this.tasks.push(task);
    return async () => {
      if (task.done) return;
      await task.run();
      task.done = true;
    };
  }

  async run(): Promise<void> {
    const failures: Error[] = [];
    for (const task of [...this.tasks].reverse()) {
      if (task.done) continue;
      try { await task.run(); task.done = true; }
      catch { failures.push(new Error(`Cleanup failed: ${task.label}. See the private recovery journal.`)); }
    }
    if (failures.length) throw new AggregateError(failures, 'Account cleanup incomplete; private recovery journal retained.');
  }
}
