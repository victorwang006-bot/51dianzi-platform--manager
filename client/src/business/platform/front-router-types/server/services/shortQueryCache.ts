type Loaded<T> = { value: T; cacheable?: boolean };
/** Process-local, bounded cache. No user-specific tokens or private data belong here. */
export class ShortQueryCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 500, private readonly now = Date.now) {}
  async get(key: string, load: () => Promise<Loaded<T>>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    this.values.delete(key);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = Promise.resolve().then(load).then(result => {
      if (result.cacheable !== false) {
        if (this.values.size >= this.maxEntries) this.values.delete(this.values.keys().next().value!);
        this.values.set(key, { value: result.value, expiresAt: this.now() + this.ttlMs });
      }
      return result.value;
    });
    if (this.pending.size < this.maxEntries) this.pending.set(key, task);
    try { return await task; }
    finally { if (this.pending.get(key) === task) this.pending.delete(key); }
  }
}
