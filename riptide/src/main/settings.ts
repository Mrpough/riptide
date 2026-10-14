import { app } from 'electron'
import { join } from 'node:path'
import { defaultSettings, MAX_CONNECTIONS, MIN_CONNECTIONS } from '@shared/defaults'
import type { Settings, StorageCategoryId } from '@shared/types'
import { CATEGORY_IDS } from '@shared/categories'
import { log } from './logger'
import { JsonStore } from './store'
import { clamp } from './utils'

function mergeSettings(base: Settings, patch: Partial<Settings> | null): Settings {
  if (!patch) return base
  const merged: Settings = {
    ...base,
    ...patch,
    proxy: { ...base.proxy, ...(patch.proxy ?? {}) },
    categoryDirs: { ...base.categoryDirs, ...(patch.categoryDirs ?? {}) }
  }
  return normalizeSettings(merged)
}

export function normalizeSettings(s: Settings): Settings {
  return {
    ...s,
    defaultConnections: Math.round(clamp(s.defaultConnections, MIN_CONNECTIONS, MAX_CONNECTIONS)),
    maxConcurrent: Math.round(clamp(s.maxConcurrent, 1, 16)),
    speedLimit: Math.max(0, Math.round(s.speedLimit || 0)),
    catchServerPort: Math.round(clamp(s.catchServerPort, 1024, 65535))
  }
}

export class SettingsService {
  private store: JsonStore<Settings>
  private listeners = new Set<(settings: Settings) => void>()

  constructor() {
    const file = join(app.getPath('userData'), 'settings.json')
    this.store = new JsonStore<Settings>(file, defaultSettings(app.getPath('downloads')))
  }

  async load(): Promise<Settings> {
    const loaded = await this.store.load()
    const merged = mergeSettings(defaultSettings(app.getPath('downloads')), loaded)
    // A stale downloadDir (e.g. profile removed) falls back to the OS default.
    if (!merged.downloadDir) merged.downloadDir = app.getPath('downloads')
    this.store.set(merged)
    return merged
  }

  get(): Settings {
    return this.store.get()
  }

  async patch(partial: Partial<Settings>): Promise<Settings> {
    const next = mergeSettings(this.store.get(), partial)
    this.store.set(next)
    await this.store.flush().catch((err) => log.error('failed to persist settings', err))
    for (const listener of this.listeners) listener(next)
    return next
  }

  async replace(next: Settings): Promise<Settings> {
    const normalized = normalizeSettings(next)
    this.store.set(normalized)
    await this.store.flush().catch((err) => log.error('failed to persist settings', err))
    for (const listener of this.listeners) listener(normalized)
    return normalized
  }

  /** Restore factory defaults, keeping the current download directory. */
  async reset(): Promise<Settings> {
    const current = this.store.get()
    const defaults = defaultSettings(app.getPath('downloads'))
    defaults.downloadDir = current.downloadDir || defaults.downloadDir
    return this.replace(defaults)
  }

  /** Resolve the destination directory for a category, honoring overrides. */
  dirFor(category: StorageCategoryId): string {
    const s = this.store.get()
    const override = s.categoryDirs[category]
    if (override && override.trim()) return override
    return s.downloadDir
  }

  onChanged(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}

export function sanitizeCategoryDirs(
  input: Partial<Record<StorageCategoryId, string>> | undefined
): Partial<Record<StorageCategoryId, string>> {
  if (!input) return {}
  const out: Partial<Record<StorageCategoryId, string>> = {}
  for (const id of CATEGORY_IDS) {
    const v = input[id]
    if (typeof v === 'string') out[id] = v
  }
  return out
}
