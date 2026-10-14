import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_LABEL } from '@shared/categories'
import { formatBytes } from '@shared/format'
import { DEFAULT_SPIDER_OPTIONS, SPIDER_LIMITS, type SpiderOptions } from '@shared/spider'
import type { StorageCategoryId } from '@shared/types'
import { useApp } from '../state/store'
import { Dialog } from './Dialog'
import { IconExternal, IconPlay, IconStop, IconTrash } from './Icons'

/** How many rows to paint at once; a huge crawl can find thousands of files. */
const MAX_ROWS = 500

const PHASE_LABEL: Record<string, string> = {
  idle: 'Ready',
  walking: 'Crawling pages',
  probing: 'Checking file sizes',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Failed'
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function SiteGrabberDialog(): JSX.Element {
  const closeGrabber = useApp((s) => s.closeGrabber)
  const spiderState = useApp((s) => s.spiderState)
  const spiderFiles = useApp((s) => s.spiderFiles)
  const setSpiderState = useApp((s) => s.setSpiderState)
  const setSpiderFiles = useApp((s) => s.setSpiderFiles)
  const pushToast = useApp((s) => s.pushToast)

  const [startUrl, setStartUrl] = useState('')
  const [maxDepth, setMaxDepth] = useState(DEFAULT_SPIDER_OPTIONS.maxDepth)
  const [maxPages, setMaxPages] = useState(DEFAULT_SPIDER_OPTIONS.maxPages)
  const [concurrency, setConcurrency] = useState(DEFAULT_SPIDER_OPTIONS.concurrency)
  const [sameHost, setSameHost] = useState(DEFAULT_SPIDER_OPTIONS.sameHost)
  const [respectRobots, setRespectRobots] = useState(DEFAULT_SPIDER_OPTIONS.respectRobots)
  const [probeSizes, setProbeSizes] = useState(DEFAULT_SPIDER_OPTIONS.probeSizes)
  const [types, setTypes] = useState<StorageCategoryId[]>(DEFAULT_SPIDER_OPTIONS.types)
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const api = window.riptide

  const phase = spiderState?.phase ?? 'idle'
  const running = phase === 'walking' || phase === 'probing'
  const filesFound = spiderState?.filesFound ?? 0

  // Load the current snapshot when the dialog opens.
  useEffect(() => {
    let cancelled = false
    void api.spider.snapshot().then((snapshot) => {
      if (cancelled) return
      setSpiderState(snapshot.state)
      setSpiderFiles(snapshot.files)
      setStartUrl((current) => current || snapshot.state.startUrl)
    })
    return () => {
      cancelled = true
    }
  }, [api, setSpiderState, setSpiderFiles])

  // Refresh the file list as the crawl finds and probes more.
  useEffect(() => {
    if (phase === 'idle' && filesFound === 0) return
    let cancelled = false
    void api.spider.snapshot().then((snapshot) => {
      if (cancelled) return
      setSpiderState(snapshot.state)
      setSpiderFiles(snapshot.files)
    })
    return () => {
      cancelled = true
    }
  }, [api, phase, filesFound, setSpiderState, setSpiderFiles])

  const selectedUrls = useMemo(
    () => spiderFiles.filter((file) => !deselected.has(file.url)).map((file) => file.url),
    [spiderFiles, deselected]
  )

  const toggleFile = (url: string): void => {
    setDeselected((current) => {
      const next = new Set(current)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const toggleType = (id: StorageCategoryId): void => {
    setTypes((current) =>
      current.includes(id) ? current.filter((type) => type !== id) : [...current, id]
    )
  }

  const start = async (): Promise<void> => {
    setError(null)
    setDeselected(new Set())
    const options: SpiderOptions = {
      startUrl,
      maxDepth,
      maxPages,
      sameHost,
      respectRobots,
      types,
      include,
      exclude,
      probeSizes,
      concurrency
    }
    const result = await api.spider.start(options)
    if (!result.ok) setError(result.error ?? 'Could not start the crawl.')
  }

  const clear = async (): Promise<void> => {
    const snapshot = await api.spider.clear()
    setSpiderState(snapshot.state)
    setSpiderFiles(snapshot.files)
    setDeselected(new Set())
  }

  const addSelected = async (): Promise<void> => {
    if (selectedUrls.length === 0 || adding) return
    setAdding(true)
    try {
      const result = await api.spider.add(selectedUrls)
      const skipped = result.skipped > 0 ? `, ${result.skipped} skipped` : ''
      pushToast({
        kind: result.added > 0 ? 'success' : 'warning',
        message: `Queued ${result.added} download${result.added === 1 ? '' : 's'}${skipped}`
      })
      if (result.added > 0) closeGrabber()
    } catch (err) {
      pushToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not queue the downloads.'
      })
    } finally {
      setAdding(false)
    }
  }

  const visibleFiles = spiderFiles.slice(0, MAX_ROWS)

  return (
    <Dialog
      title="Site grabber"
      wide
      onClose={closeGrabber}
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={running || spiderFiles.length === 0}
            onClick={() => void clear()}
          >
            <IconTrash size={14} />
            Clear results
          </button>
          <div className="toolbar__spacer" />
          <button type="button" className="btn" onClick={closeGrabber}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={selectedUrls.length === 0 || adding}
            onClick={() => void addSelected()}
          >
            Add {selectedUrls.length > 0 ? selectedUrls.length : ''} to Riptide
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="spider-url">
          Site URL
        </label>
        <div className="field__row">
          <input
            id="spider-url"
            className="input"
            value={startUrl}
            spellCheck={false}
            placeholder="https://example.com/media/"
            onChange={(e) => setStartUrl(e.target.value)}
          />
          {running ? (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void api.spider.stop()}
            >
              <IconStop size={14} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={startUrl.trim().length === 0}
              onClick={() => void start()}
            >
              <IconPlay size={14} />
              Scan
            </button>
          )}
        </div>
        <span className="field__help">
          Riptide walks the pages, collects links that match the types below, then optionally checks each
          file's size. Nothing is downloaded until you add it.
        </span>
      </div>

      <div className="spider__stats" data-phase={phase}>
        <span className="spider__stat">
          <b>{PHASE_LABEL[phase] ?? phase}</b>
        </span>
        <span className="spider__stat">Pages: {spiderState?.pagesCrawled ?? 0}</span>
        <span className="spider__stat">Queued: {spiderState?.queueLength ?? 0}</span>
        <span className="spider__stat">Files: {filesFound}</span>
        {phase === 'probing' && (
          <span className="spider__stat">
            Checked: {spiderState?.filesProbed ?? 0}/{filesFound}
          </span>
        )}
        {running && spiderState?.currentUrl && (
          <span className="spider__stat spider__stat--url" title={spiderState.currentUrl}>
            {spiderState.currentUrl}
          </span>
        )}
        {phase === 'error' && spiderState?.error && (
          <span className="spider__stat spider__stat--error">{spiderState.error}</span>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="spider-depth">
            Max depth
          </label>
          <input
            id="spider-depth"
            className="input"
            type="number"
            min={0}
            max={SPIDER_LIMITS.maxDepth}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Math.max(0, Math.min(SPIDER_LIMITS.maxDepth, Number(e.target.value) || 0)))}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="spider-pages">
            Max pages
          </label>
          <input
            id="spider-pages"
            className="input"
            type="number"
            min={1}
            max={SPIDER_LIMITS.maxPages}
            value={maxPages}
            onChange={(e) =>
              setMaxPages(Math.max(1, Math.min(SPIDER_LIMITS.maxPages, Number(e.target.value) || 1)))
            }
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="spider-conc">
          Parallel pages: {concurrency}
        </label>
        <input
          id="spider-conc"
          type="range"
          min={1}
          max={SPIDER_LIMITS.concurrency}
          value={concurrency}
          onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
        />
      </div>

      <div className="spider__types">
        <span className="field__label">File types</span>
        <div className="spider__chips">
          {CATEGORIES.map((category) => (
            <label key={category.id} className="spider__chip" data-on={types.includes(category.id)}>
              <input
                type="checkbox"
                checked={types.includes(category.id)}
                onChange={() => toggleType(category.id)}
              />
              {category.label}
            </label>
          ))}
        </div>
        <span className="field__help">
          Leave every type unchecked to keep any file the crawl finds.
        </span>
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="field__label" htmlFor="spider-include">
            Include pattern (regex)
          </label>
          <input
            id="spider-include"
            className="input"
            value={include}
            spellCheck={false}
            placeholder="\\.mp4$"
            onChange={(e) => setInclude(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="spider-exclude">
            Exclude pattern (regex)
          </label>
          <input
            id="spider-exclude"
            className="input"
            value={exclude}
            spellCheck={false}
            placeholder="preview|sample"
            onChange={(e) => setExclude(e.target.value)}
          />
        </div>
      </div>

      <div className="spider__switches">
        <label className="switch">
          <input type="checkbox" checked={sameHost} onChange={(e) => setSameHost(e.target.checked)} />
          <span className="switch__text">
            <span className="switch__title">Stay on this site</span>
            <span className="switch__desc">Only follow pages on the starting host.</span>
          </span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={respectRobots}
            onChange={(e) => setRespectRobots(e.target.checked)}
          />
          <span className="switch__text">
            <span className="switch__title">Respect robots.txt</span>
            <span className="switch__desc">Skip pages the site asks crawlers to avoid.</span>
          </span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={probeSizes}
            onChange={(e) => setProbeSizes(e.target.checked)}
          />
          <span className="switch__text">
            <span className="switch__title">Check file sizes</span>
            <span className="switch__desc">Ask each server for size and type after the walk.</span>
          </span>
        </label>
      </div>

      {error && (
        <div className="probe" data-tone="error" role="alert">
          {error}
        </div>
      )}

      {spiderFiles.length > 0 && (
        <div className="spider__list">
          <div className="spider__tools">
            <span className="field__label">
              {spiderFiles.length} file{spiderFiles.length === 1 ? '' : 's'} found
            </span>
            <div className="toolbar__spacer" />
            <button type="button" className="btn btn--sm" onClick={() => setDeselected(new Set())}>
              Select all
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setDeselected(new Set(spiderFiles.map((file) => file.url)))}
            >
              Select none
            </button>
          </div>
          <div className="spider__rows">
            {visibleFiles.map((file) => (
              <label key={file.url} className="spider__row">
                <input
                  type="checkbox"
                  checked={!deselected.has(file.url)}
                  onChange={() => toggleFile(file.url)}
                />
                <span className="spider__name" title={`${file.url}\nfound on ${hostLabel(file.pageUrl)}`}>
                  {file.fileName}
                </span>
                <span className="spider__cat">{CATEGORY_LABEL[file.category]}</span>
                <span className="spider__size">{file.size >= 0 ? formatBytes(file.size) : '—'}</span>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="Open link in browser"
                  title="Open in browser"
                  onClick={(e) => {
                    e.preventDefault()
                    void api.shell.openExternal(file.url)
                  }}
                >
                  <IconExternal size={13} />
                </button>
              </label>
            ))}
          </div>
          {spiderFiles.length > MAX_ROWS && (
            <span className="field__help">
              Showing the first {MAX_ROWS} of {spiderFiles.length} files; all of them will be added.
            </span>
          )}
        </div>
      )}
    </Dialog>
  )
}
