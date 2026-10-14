import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from '@shared/categories'
import { formatBytes } from '@shared/format'
import { isStreamKind, kindFromMime, kindFromUrl } from '@shared/stream'
import type { AddDownloadInput, ProbePreview, StorageCategoryId } from '@shared/types'
import { useApp } from '../state/store'
import { Dialog } from './Dialog'
import { IconFolder, IconRefresh } from './Icons'

/** Parse `Name: value` lines into a header map; blank lines are ignored. */
function parseHeaders(text: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    headers[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim()
    count += 1
  }
  return count > 0 ? headers : undefined
}

function splitUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

interface ProbeState {
  loading: boolean
  preview: ProbePreview | null
  error: string | null
}

const IDLE: ProbeState = { loading: false, preview: null, error: null }

export function AddDownloadDialog(): JSX.Element {
  const initialUrl = useApp((s) => s.addDialogInitialUrl)
  const closeAddDialog = useApp((s) => s.closeAddDialog)
  const settings = useApp((s) => s.settings)

  const [url, setUrl] = useState(initialUrl)
  const [saveDir, setSaveDir] = useState(settings?.downloadDir ?? '')
  const [fileName, setFileName] = useState('')
  const [connections, setConnections] = useState(settings?.defaultConnections ?? 8)
  const [category, setCategory] = useState<StorageCategoryId | ''>('')
  const [startNow, setStartNow] = useState(settings?.startOnAdd ?? true)
  const [headersText, setHeadersText] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [probe, setProbe] = useState<ProbeState>(IDLE)

  const api = window.riptide
  const probeSeq = useRef(0)

  const urls = useMemo(() => splitUrls(url), [url])
  const singleUrl = urls.length === 1 ? urls[0] : null

  // A streaming playlist is either obvious from the URL, or revealed by the
  // probe's Content-Type once the server answers.
  const streamKind = useMemo(() => {
    const fromUrl = singleUrl ? kindFromUrl(singleUrl) : 'http'
    if (fromUrl !== 'http') return fromUrl
    return probe.preview ? (kindFromMime(probe.preview.mimeType) ?? 'http') : 'http'
  }, [singleUrl, probe.preview])

  const streamLabel =
    streamKind === 'hls'
      ? 'HLS playlist (segmented)'
      : streamKind === 'dash'
        ? 'DASH manifest (segmented)'
        : null

  // Keep the default save directory in sync until the user edits it.
  const dirEdited = useRef(false)
  useEffect(() => {
    if (!dirEdited.current && settings) setSaveDir(settings.downloadDir)
  }, [settings])

  // Probe a single URL on a short debounce so we can show size/support up front.
  useEffect(() => {
    if (!singleUrl) {
      setProbe(IDLE)
      return
    }
    const seq = ++probeSeq.current
    setProbe({ loading: true, preview: null, error: null })
    const timer = window.setTimeout(() => {
      api.downloads
        .probe(singleUrl)
        .then((preview) => {
          if (seq !== probeSeq.current) return
          setProbe({ loading: false, preview, error: null })
          setCategory(preview.category)
        })
        .catch((error: unknown) => {
          if (seq !== probeSeq.current) return
          setProbe({
            loading: false,
            preview: null,
            error: error instanceof Error ? error.message : String(error)
          })
        })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [singleUrl, api])

  const chooseDir = async (): Promise<void> => {
    const dir = await api.dialogs.chooseDir(saveDir || undefined)
    if (dir) {
      dirEdited.current = true
      setSaveDir(dir)
    }
  }

  const submit = async (): Promise<void> => {
    if (urls.length === 0 || submitting) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const headers = parseHeaders(headersText)
      if (urls.length > 1) {
        const inputs: AddDownloadInput[] = urls.map((u) => {
          const kind = kindFromUrl(u)
          return {
            url: u,
            saveDir: saveDir || undefined,
            connections,
            startNow,
            ...(isStreamKind(kind) ? { kind } : {}),
            ...(headers ? { headers } : {})
          }
        })
        const results = await api.downloads.addBatch(inputs)
        const failed = results.filter((r) => !r.ok)
        if (failed.length > 0) {
          setSubmitError(failed.map((r) => r.error).filter(Boolean).join('; ') || 'Some downloads failed to start.')
        } else {
          closeAddDialog()
        }
      } else {
        const input: AddDownloadInput = {
          url: urls[0],
          saveDir: saveDir || undefined,
          connections,
          startNow,
          ...(headers ? { headers } : {})
        }
        if (fileName.trim()) input.fileName = fileName.trim()
        if (category) input.category = category
        if (isStreamKind(streamKind)) input.kind = streamKind
        const result = await api.downloads.add(input)
        if (result.ok) closeAddDialog()
        else setSubmitError(result.error ?? 'Could not start the download.')
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const preview = probe.preview

  return (
    <Dialog
      title="Add download"
      onClose={closeAddDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={() => setUrl('')}>
            Clear
          </button>
          <div className="toolbar__spacer" />
          <button type="button" className="btn" onClick={closeAddDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={urls.length === 0 || submitting}
            onClick={() => void submit()}
          >
            {urls.length > 1 ? `Add ${urls.length} downloads` : 'Download'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="add-url">
          File URL{urls.length > 1 ? 's (one per line)' : ''}
        </label>
        <textarea
          id="add-url"
          className="textarea"
          value={url}
          spellCheck={false}
          placeholder={'https://example.com/file.zip\nhttps://example.com/mirror/file.zip'}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={url.trim().length > 0 && urls.length === 0 ? 'true' : undefined}
        />
        {urls.length > 1 && <span className="field__help">{urls.length} links detected.</span>}
      </div>

      <div className="field">
        <span className="field__label">File info</span>
        <div className="probe" data-tone={preview ? 'ok' : probe.error ? 'error' : undefined}>
          {probe.loading && (
            <>
              <IconRefresh size={13} />
              Probing…
            </>
          )}
          {!probe.loading && probe.error && <>{probe.error}</>}
          {!probe.loading && !probe.error && preview && (
            <>
              <b>{preview.fileName}</b>
              <span>{preview.size > 0 ? formatBytes(preview.size) : 'size unknown'}</span>
              <span>{streamLabel ?? (preview.supportsRanges ? 'resumable' : 'single connection')}</span>
            </>
          )}
          {!probe.loading && !probe.error && !preview && (
            <span>
              {streamLabel ??
                (singleUrl ? 'Checking the link…' : 'Add one link to check server support.')}
            </span>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="add-save">
            Save to
          </label>
          <div className="field__row">
            <input
              id="add-save"
              className="input"
              value={saveDir}
              spellCheck={false}
              onChange={(e) => {
                dirEdited.current = true
                setSaveDir(e.target.value)
              }}
            />
            <button
              type="button"
              className="btn btn--icon btn--bordered"
              title="Browse…"
              aria-label="Choose save folder"
              onClick={() => void chooseDir()}
            >
              <IconFolder size={15} />
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="add-name">
            File name{urls.length > 1 && ' (single link only)'}
          </label>
          <input
            id="add-name"
            className="input"
            value={fileName}
            disabled={urls.length !== 1}
            spellCheck={false}
            placeholder={preview?.fileName ?? 'Use server name'}
            onChange={(e) => setFileName(e.target.value)}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="add-cat">
            Category
          </label>
          <select
            id="add-cat"
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value as StorageCategoryId | '')}
          >
            <option value="">Auto-detect</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="add-conn">
            Connections
          </label>
          <input
            id="add-conn"
            className="input"
            type="number"
            min={1}
            max={32}
            value={connections}
            onChange={(e) => setConnections(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
          />
        </div>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={startNow}
          onChange={(e) => setStartNow(e.target.checked)}
        />
        <span className="switch__text">
          <span className="switch__title">Start immediately</span>
          <span className="switch__desc">
            Otherwise the download waits in the queue until you start it.
          </span>
        </span>
      </label>

      <div className="field">
        <button
          type="button"
          className="btn"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? 'Hide request headers' : 'Add request headers (Cookie, Authorization)'}
        </button>
        {showAdvanced && (
          <>
            <textarea
              className="textarea"
              value={headersText}
              spellCheck={false}
              placeholder={'Cookie: session=…\nAuthorization: Bearer …'}
              onChange={(e) => setHeadersText(e.target.value)}
            />
            <span className="field__help">
              One header per line. Useful for files behind a login.
            </span>
          </>
        )}
      </div>

      {submitError && (
        <div className="probe" data-tone="error" role="alert">
          {submitError}
        </div>
      )}
    </Dialog>
  )
}
