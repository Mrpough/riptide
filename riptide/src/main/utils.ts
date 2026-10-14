import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function createId(): string {
  return randomUUID()
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal }) as Promise<void>
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string; message?: string }
  return (
    e.name === 'AbortError' ||
    e.code === 'ABORT_ERR' ||
    e.code === 'UND_ERR_ABORTED' ||
    /aborted/i.test(e.message ?? '')
  )
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export async function fileSize(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path)
    return stat.size
  } catch {
    return -1
  }
}

/** Write a file atomically: full write to a temp file, then rename over target. */
export async function atomicWriteFile(path: string, data: string | Buffer): Promise<void> {
  await ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, path)
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(value, null, 2))
}

/** Append a `.part` marker next to a file path. */
export function partPath(filePath: string): string {
  return `${filePath}.riptide-part`
}

/** Return a path that does not yet collide, appending " (n)" before the ext. */
export function uniqueName(
  dir: string,
  fileName: string,
  taken: ReadonlySet<string>
): string {
  const ext = extname(fileName)
  const base = ext ? fileName.slice(0, -ext.length) : fileName
  let candidate = fileName
  let n = 1
  const key = (name: string) => join(dir, name).toLowerCase()
  while (taken.has(key(candidate))) {
    candidate = `${base} (${n})${ext}`
    n++
  }
  return candidate
}

export function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

/**
 * Like {@link uniqueName} but also treats files already present on disk as
 * taken, so a fresh download never silently clobbers an existing file.
 */
export async function uniqueFileNameOnDisk(
  dir: string,
  fileName: string,
  taken: ReadonlySet<string>
): Promise<string> {
  const ext = extname(fileName)
  const base = ext ? fileName.slice(0, -ext.length) : fileName
  const key = (name: string) => join(dir, name).toLowerCase()
  let candidate = fileName
  let n = 1
  for (;;) {
    if (!taken.has(key(candidate)) && !(await pathExists(join(dir, candidate)))) return candidate
    candidate = `${base} (${n})${ext}`
    n += 1
    if (n > 10_000) return candidate
  }
}
