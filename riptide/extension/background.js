/**
 * Riptide browser bridge — MV3 service worker.
 *
 * Link, media and selection captures are POSTed as JSON to the Riptide desktop
 * app over its loopback "catch" endpoint (http://127.0.0.1:<port>/add). That
 * endpoint only ever listens on the loopback interface, so it is never
 * reachable from the local network.
 *
 * The popup talks to this worker with chrome.runtime.sendMessage and the
 * supported message types are: 'ping', 'get-settings', 'set-settings', 'add'.
 */

const DEFAULT_SETTINGS = Object.freeze({ port: 7777, interceptDownloads: false })

/** Menus are re-created whenever the worker is installed or the browser starts. */
const MENUS = [
  { id: 'riptide-link', title: 'Download with Riptide', contexts: ['link'] },
  { id: 'riptide-media', title: 'Download with Riptide', contexts: ['video', 'audio', 'image'] },
  { id: 'riptide-selection', title: 'Send to Riptide', contexts: ['selection'] }
]

function clampPort(value) {
  const port = Number(value)
  if (!Number.isFinite(port)) return DEFAULT_SETTINGS.port
  return Math.max(1024, Math.min(65535, Math.trunc(port)))
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS)
  return {
    port: clampPort(stored.port),
    interceptDownloads: Boolean(stored.interceptDownloads)
  }
}

function endpoint(port, path) {
  return `http://127.0.0.1:${port}${path}`
}

/** Wrap fetch with an abort timeout so a dead app cannot hang the worker. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** POST a download to the app. Always resolves to a normalised result. */
async function sendToRiptide(payload) {
  const { port } = await getSettings()
  const url = payload && typeof payload.url === 'string' ? payload.url.trim() : ''

  if (!isHttpUrl(url)) {
    return { ok: false, error: 'Only http(s) links can be sent to Riptide.' }
  }

  const body = { url, source: 'chrome-extension' }
  if (payload.referrer) body.referrer = payload.referrer
  if (payload.fileName) body.fileName = payload.fileName
  if (payload.headers) body.headers = payload.headers
  if (payload.startNow === false) body.startNow = false

  try {
    const response = await fetchWithTimeout(
      endpoint(port, '/add'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      },
      8000
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) {
      return { ok: false, error: data.error || `Riptide replied with HTTP ${response.status}.` }
    }
    return { ok: true, id: data.id }
  } catch (err) {
    const aborted = err && err.name === 'AbortError'
    return {
      ok: false,
      offline: true,
      error: aborted
        ? 'Riptide did not respond in time.'
        : 'Riptide is not running. Open the app and try again.'
    }
  }
}

/** Ask the app whether the loopback endpoint is listening. */
async function ping() {
  const { port } = await getSettings()
  try {
    const response = await fetchWithTimeout(endpoint(port, '/ping'), {}, 4000)
    if (!response.ok) return { ok: false, running: false }
    const data = await response.json().catch(() => ({}))
    return { ok: true, running: data.app === 'riptide', version: data.version }
  } catch {
    return { ok: false, running: false }
  }
}

// ---- lightweight on-icon feedback -----------------------------------------

let badgeTimer = null

async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color })
    await chrome.action.setBadgeText({ text })
    if (badgeTimer) clearTimeout(badgeTimer)
    badgeTimer = setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {})
    }, 2000)
  } catch {
    /* badge is cosmetic; ignore */
  }
}

// ---- context menus ---------------------------------------------------------

function installMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) {
      // create() may re-report an existing id; ignore that race.
      try {
        chrome.contextMenus.create(menu)
      } catch {
        /* already present */
      }
    }
  })
}

chrome.runtime.onInstalled.addListener(installMenus)
chrome.runtime.onStartup.addListener(installMenus)

chrome.contextMenus.onClicked.addListener(async (info) => {
  let url = ''
  if (info.menuItemId === 'riptide-link') url = info.linkUrl || ''
  else if (info.menuItemId === 'riptide-media') url = info.srcUrl || ''
  else if (info.menuItemId === 'riptide-selection') url = (info.selectionText || '').trim()
  if (!url) return

  const result = await sendToRiptide({ url, referrer: info.pageUrl })
  await flashBadge(result.ok ? '✓' : '!', result.ok ? '#ff6a2b' : '#e5484d')
})

// ---- optional download catching -------------------------------------------

const intercepted = new Set()

if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    const settings = await getSettings()
    if (!settings.interceptDownloads) return

    const url = item.finalUrl || item.url || ''
    if (!isHttpUrl(url)) return
    if (intercepted.has(item.id)) return

    intercepted.add(item.id)
    setTimeout(() => intercepted.delete(item.id), 15000)

    try {
      await chrome.downloads.cancel(item.id)
      await chrome.downloads.erase({ id: item.id })
    } catch {
      /* the download may already have finished or been removed */
    }

    await sendToRiptide({ url, referrer: item.referrer })
  })
}

// ---- popup messaging -------------------------------------------------------

async function handleMessage(message) {
  const type = message && message.type
  if (type === 'ping') return ping()
  if (type === 'get-settings') return { ok: true, settings: await getSettings() }
  if (type === 'set-settings') {
    const patch = {}
    if (message.settings && 'port' in message.settings) patch.port = clampPort(message.settings.port)
    if (message.settings && 'interceptDownloads' in message.settings) {
      patch.interceptDownloads = Boolean(message.settings.interceptDownloads)
    }
    if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch)
    return { ok: true, settings: await getSettings() }
  }
  if (type === 'add') return sendToRiptide(message.payload || {})
  return { ok: false, error: `Unknown message: ${type}` }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }))
  return true // keep the channel open for the async reply
})
