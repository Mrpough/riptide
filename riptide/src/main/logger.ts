import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL: Level = (process.env.RIPTIDE_LOG_LEVEL as Level) || 'info'

let logFile: string | null = null
let streamBroken = false

function resolveLogFile(): string | null {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 10)
    logFile = join(dir, `riptide-${stamp}.log`)
    return logFile
  } catch {
    return null
  }
}

function write(level: Level, scope: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
  const time = new Date().toISOString()
  const parts = args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}`
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    }
    return String(a)
  })
  const line = `${time} [${level.toUpperCase()}] [${scope}] ${parts.join(' ')}`

  // eslint-disable-next-line no-console
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(line)

  const file = resolveLogFile()
  if (file && !streamBroken) {
    try {
      appendFileSync(file, line + '\n')
    } catch {
      streamBroken = true
    }
  }
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(scope: string): Logger
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
    child: (child) => createLogger(`${scope}:${child}`)
  }
}

export const log = createLogger('app')

export function logFilePath(): string | null {
  return resolveLogFile()
}
