import { Notification, shell } from 'electron'
import type { DownloadView } from '@shared/types'
import { formatBytes } from '@shared/format'
import { createLogger } from './logger'

const log = createLogger('notify')

export function notifyDownloadComplete(item: DownloadView, enabled: boolean): void {
  if (!enabled || !Notification.isSupported()) return
  try {
    const size = item.size > 0 ? ` · ${formatBytes(item.size)}` : ''
    const notification = new Notification({
      title: 'Download complete',
      body: `${item.fileName}${size}`,
      silent: false
    })
    notification.on('click', () => {
      if (item.filePath) shell.showItemInFolder(item.filePath)
    })
    notification.show()
  } catch (err) {
    log.warn('failed to show notification', err)
  }
}

export function notifyInfo(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body }).show()
  } catch {
    /* ignore */
  }
}
