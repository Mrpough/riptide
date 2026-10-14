/** Popup controller: status, manual send, and the two persisted options. */

const $ = (id) => document.getElementById(id)

function send(message) {
  return chrome.runtime.sendMessage(message)
}

function setStatus(state, text) {
  $('status').dataset.state = state
  $('status-text').textContent = text
}

function flash(text, tone) {
  const el = $('message')
  el.textContent = text || ''
  el.dataset.tone = tone || 'info'
}

async function refreshStatus() {
  setStatus('unknown', 'Checking…')
  const res = await send({ type: 'ping' })
  if (res && res.running) setStatus('on', res.version ? `Connected · v${res.version}` : 'Connected')
  else setStatus('off', 'App not running')
  return res
}

async function prefillCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab && /^https?:\/\//i.test(tab.url || '')) $('url').value = tab.url
  } catch {
    /* no tabs access; the field stays empty */
  }
}

async function loadSettings() {
  const res = await send({ type: 'get-settings' })
  if (res && res.settings) {
    $('intercept').checked = Boolean(res.settings.interceptDownloads)
    $('port').value = res.settings.port
  }
}

async function onSend() {
  const url = $('url').value.trim()
  if (!url) {
    flash('Paste a link first.', 'error')
    return
  }
  const fileName = $('filename').value.trim()
  $('send').disabled = true
  flash('Sending…', 'info')
  const res = await send({ type: 'add', payload: { url, fileName: fileName || undefined } })
  $('send').disabled = false
  if (res && res.ok) {
    flash('Handed to Riptide.', 'success')
    setStatus('on', 'Connected')
    $('filename').value = ''
  } else {
    flash((res && res.error) || 'Could not reach Riptide.', 'error')
    setStatus('off', 'App not running')
  }
}

function bind() {
  $('send').addEventListener('click', () => void onSend())
  $('retry').addEventListener('click', () => void refreshStatus())
  $('url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void onSend()
  })
  $('intercept').addEventListener('change', async (event) => {
    await send({ type: 'set-settings', settings: { interceptDownloads: event.target.checked } })
    flash(
      event.target.checked
        ? 'Chrome downloads will be routed to Riptide.'
        : 'Browser download catching is off.',
      'info'
    )
  })
  $('port').addEventListener('change', async (event) => {
    const res = await send({ type: 'set-settings', settings: { port: event.target.value } })
    if (res && res.settings) $('port').value = res.settings.port
    await refreshStatus()
  })
}

document.addEventListener('DOMContentLoaded', () => {
  bind()
  void (async () => {
    await loadSettings()
    await prefillCurrentTab()
    await refreshStatus()
  })()
})
