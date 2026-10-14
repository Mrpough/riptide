import { clipboard } from 'electron'
import { createLogger } from '../logger'

const log = createLogger('clipboard')

const URL_PATTERN = /^https?:\/\/[^\s"'<>]+$/i

/**
 * Watches the clipboard and surfaces new http(s) URLs so the UI can offer to
 * download them. Only fires when the text actually changes and looks like a
 * single bare URL, which keeps false positives low.
 */
export class ClipboardMonitor {
  private timer: NodeJS.Timeout | null = null
  private lastSeen = ''

  constructor(private readonly onUrl: (url: string) => void) {}

  async start(): Promise<void> {
    if (this.timer) return
    this.lastSeen = await safeRead()
    this.timer = setInterval(() => void this.poll(), 1000)
    log.info('clipboard monitoring started')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    log.info('clipboard monitoring stopped')
  }

  get running(): boolean {
    return this.timer !== null
  }

  private async poll(): Promise<void> {
    const text = await safeRead()
    if (text === this.lastSeen) return
    this.lastSeen = text
    if (!text || text.length > 2048) return
    if (!URL_PATTERN.test(text)) return
    if (/^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(text)) return
    this.onUrl(text)
  }
}

async function safeRead(): Promise<string> {
  try {
    return (await clipboard.readText()).trim()
  } catch {
    return ''
  }
}
