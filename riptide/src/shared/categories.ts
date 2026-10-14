import type { CategoryId, StorageCategoryId } from './types'

export interface CategoryMeta {
  id: StorageCategoryId
  label: string
  /** Folder name used when category folders are enabled. */
  folder: string
}

/** Order matters: it drives the sidebar order. */
export const CATEGORIES: CategoryMeta[] = [
  { id: 'compressed', label: 'Compressed', folder: 'Compressed' },
  { id: 'documents', label: 'Documents', folder: 'Documents' },
  { id: 'music', label: 'Music', folder: 'Music' },
  { id: 'video', label: 'Video', folder: 'Video' },
  { id: 'programs', label: 'Programs', folder: 'Programs' },
  { id: 'other', label: 'Other', folder: 'Other' }
]

export const CATEGORY_IDS: StorageCategoryId[] = CATEGORIES.map((c) => c.id)

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  all: 'All Downloads',
  compressed: 'Compressed',
  documents: 'Documents',
  music: 'Music',
  video: 'Video',
  programs: 'Programs',
  other: 'Other'
}

const EXT_MAP: Record<string, StorageCategoryId> = {}

function register(category: StorageCategoryId, exts: string[]): void {
  for (const ext of exts) EXT_MAP[ext] = category
}

register('compressed', [
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab',
  'arj', 'lzh', 'ace', 'zipx', 'jar'
])

register('documents', [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'txt', 'rtf',
  'odt', 'ods', 'odp', 'csv', 'tsv', 'epub', 'mobi', 'azw3', 'djvu', 'md',
  'json', 'xml', 'yaml', 'yml'
])

register('music', [
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'wma', 'opus', 'aiff',
  'alac', 'mid', 'midi', 'ape', 'dsf'
])

register('video', [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg',
  'ts', 'm2ts', '3gp', 'ogv', 'vob', 'rmvb', 'divx'
])

register('programs', [
  'exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage',
  'bat', 'cmd', 'sh', 'bin', 'run', 'flatpak', 'snap', 'x86_64', 'x64'
])

/** Extension (lowercase, without dot) -> category. */
const MIME_MAP: Array<[RegExp, StorageCategoryId]> = [
  [/^application\/(zip|gzip|x-7z-compressed|x-rar|x-tar|x-bzip|x-bzip2|x-xz|x-compressed-tar|x-apple-diskimage|x-msdownload|x-msi|x-appx)/, 'compressed'],
  [/^application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.ms-powerpoint|rtf|epub|json|xml|vnd\.oasis)/, 'documents'],
  [/^text\//, 'documents'],
  [/^audio\//, 'music'],
  [/^video\//, 'video'],
  [/^application\/(x-msdownload|x-msdos-program|x-msi|x-appimage|x-deb|x-rpm|vnd\.android\.package-archive|octet-stream)/, 'programs']
]

export function categoryFromFileName(fileName: string): StorageCategoryId {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return 'other'
  const ext = fileName.slice(dot + 1).toLowerCase()
  return EXT_MAP[ext] ?? 'other'
}

export function categoryFromMime(mime: string | undefined): StorageCategoryId | null {
  if (!mime) return null
  const base = mime.split(';')[0].trim().toLowerCase()
  for (const [re, cat] of MIME_MAP) if (re.test(base)) return cat
  return null
}

export function detectCategory(fileName: string, mime?: string): StorageCategoryId {
  const byExt = categoryFromFileName(fileName)
  if (byExt !== 'other') return byExt
  return categoryFromMime(mime) ?? 'other'
}

export function categoryFolder(category: StorageCategoryId): string {
  return CATEGORIES.find((c) => c.id === category)?.folder ?? 'Other'
}
