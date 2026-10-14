import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { appIcon } from './icons'
import { createLogger } from './logger'

const log = createLogger('window')

export function createMainWindow(): BrowserWindow {
  const preload = join(__dirname, '../preload/index.js')

  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 580,
    show: false,
    frame: false,
    title: 'Riptide',
    backgroundColor: '#15181d',
    icon: appIcon(256),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  window.once('ready-to-show', () => window.show())

  const emitMaximize = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send('ev:window:maximized', window.isMaximized())
    }
  }
  window.on('maximize', emitMaximize)
  window.on('unmaximize', emitMaximize)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error(`did-fail-load ${code} ${description} ${url}`)
  })

  if (!app.isPackaged) {
    window.webContents.on('console-message', (details) => {
      const where = `${details.sourceId}:${details.lineNumber}`
      const text = `[renderer:${details.level}] ${details.message} (${where})`
      if (details.level === 'error') log.error(text)
      else if (details.level === 'warning') log.warn(text)
      else log.debug(text)
    })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('renderer process gone', details.reason)
  })

  return window
}
