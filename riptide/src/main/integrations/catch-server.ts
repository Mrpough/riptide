import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddDownloadInput, AddResult } from '@shared/types'
import { createLogger } from '../logger'

const log = createLogger('catch')

export interface CatchPayload extends AddDownloadInput {
  /** Free-form source tag, e.g. "chrome-extension". */
  source?: string
}

export type CatchHandler = (payload: CatchPayload) => Promise<AddResult>

interface CatchServerOptions {
  handler: CatchHandler
  version: () => string
}

/**
 * A tiny loopback HTTP endpoint that browser extensions (or a bookmarklet)
 * POST download links to. Bound to 127.0.0.1 only.
 */
export class CatchServer {
  private server: Server | null = null
  private readonly options: CatchServerOptions

  constructor(options: CatchServerOptions) {
    this.options = options
  }

  get port(): number {
    const address = this.server?.address()
    return address && typeof address === 'object' ? address.port : 0
  }

  get running(): boolean {
    return this.server !== null
  }

  async start(port: number): Promise<boolean> {
    if (this.server) return true
    const server = createServer((req, res) => void this.handle(req, res))
    server.on('error', (err) => log.warn('catch server error', err))

    const ok = await new Promise<boolean>((resolve) => {
      const onError = (): void => resolve(false)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve(true)
      })
    })

    if (!ok) {
      log.warn(`could not bind catch server to 127.0.0.1:${port}`)
      return false
    }
    this.server = server
    log.info(`catch server listening on http://127.0.0.1:${this.port}/add`)
    return true
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && (url.pathname === '/ping' || url.pathname === '/')) {
      this.json(res, 200, { ok: true, app: 'riptide', version: this.options.version() })
      return
    }

    if (req.method === 'GET' && url.pathname === '/add') {
      const target = url.searchParams.get('url')
      if (!target) {
        this.json(res, 400, { ok: false, error: 'Missing url parameter' })
        return
      }
      const result = await this.options.handler({
        url: target,
        referrer: url.searchParams.get('referrer') ?? undefined,
        fileName: url.searchParams.get('filename') ?? undefined,
        startNow: url.searchParams.get('start') !== 'false'
      })
      this.json(res, result.ok ? 200 : 400, result)
      return
    }

    if (req.method === 'POST' && url.pathname === '/add') {
      let body: string
      try {
        body = await readBody(req, 1024 * 1024)
      } catch (err) {
        this.json(res, 413, { ok: false, error: (err as Error).message })
        return
      }
      let payload: CatchPayload
      try {
        payload = body ? (JSON.parse(body) as CatchPayload) : ({} as CatchPayload)
      } catch {
        this.json(res, 400, { ok: false, error: 'Body must be valid JSON' })
        return
      }
      if (!payload.url) {
        this.json(res, 400, { ok: false, error: 'A url field is required' })
        return
      }
      const result = await this.options.handler(payload)
      this.json(res, result.ok ? 200 : 400, result)
      return
    }

    this.json(res, 404, { ok: false, error: 'Not found' })
  }

  private json(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(body)
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
