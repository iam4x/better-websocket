export interface Sized {
  size: number;
}

export class RingBufferQueue<T extends Sized> {
  private buffer: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private totalBytes = 0;

  constructor(private maxCount: number, private maxBytes: number) {
    this.buffer = new Array(maxCount);
  }

  get length(): number {
    return this.count;
  }

  get byteSize(): number {
    return this.totalBytes;
  }

  push(item: T): void {
    if (item.size > this.maxBytes) {
      throw new Error("Item size exceeds queue byte limit");
    }

    while (this.count >= this.maxCount || this.totalBytes + item.size > this.maxBytes) {
      this.shift();
    }

    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.maxCount;
    if (this.count < this.maxCount) {
      this.count++;
    }
    this.totalBytes += item.size;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.maxCount;
    this.count--;
    if (item) {
      this.totalBytes -= item.size;
    }
    return item;
  }

  clear(): void {
    this.buffer = new Array(this.maxCount);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.totalBytes = 0;
  }

  values(): T[] {
    const items: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.maxCount;
      const item = this.buffer[idx];
      if (item !== undefined) {
        items.push(item);
      }
    }
    return items;
  }
}
