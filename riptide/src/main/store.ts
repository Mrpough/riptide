import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { atomicWriteJson, readJsonFile } from './utils'

interface Envelope<T> {
  version: number
  data: T
}

/**
 * A tiny debounced JSON store with atomic writes. Enough for a download list
 * and a settings blob; keeps the main process free of native dependencies.
 */
export class JsonStore<T> {
  private readonly file: string
  private value: T
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> | null = null
  private readonly version: number

  constructor(file: string, fallback: T, version = 1) {
    this.file = file
    this.value = fallback
    this.version = version
  }

  async load(): Promise<T> {
    const parsed = await readJsonFile<Envelope<T> | T>(this.file)
    if (parsed && typeof parsed === 'object') {
      if ('version' in parsed && 'data' in parsed) {
        this.value = (parsed as Envelope<T>).data
      } else {
        this.value = parsed as T
      }
    }
    return this.value
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    this.schedule()
  }

  update(fn: (current: T) => T): T {
    this.value = fn(this.value)
    this.schedule()
    return this.value
  }

  /** Persist immediately and wait for the write to land. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty && !this.writing) return
    if (this.writing) await this.writing
    if (!this.dirty) return
    this.dirty = false
    const payload: Envelope<T> = { version: this.version, data: this.value }
    this.writing = (async () => {
      try {
        await fs.mkdir(dirname(this.file), { recursive: true })
        await atomicWriteJson(this.file, payload)
      } finally {
        this.writing = null
      }
    })()
    await this.writing
  }

  private schedule(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch(() => {
        /* handled by logger at call site */
      })
    }, 750)
  }
}
