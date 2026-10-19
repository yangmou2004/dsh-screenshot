import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

export const name = 'dsh-screenshot-plugin'
export const inject = ['tools', 'attachments']

const SCRIPT_PATH = fileURLToPath(new URL('./capture.ps1', import.meta.url))
const MARKER = 'DSH_SHOT:'
const CAPTURE_ROUTE = '/plugins/dsh-screenshot/capture'
const WINDOWS_ROUTE = '/plugins/dsh-screenshot/windows'
const DEFAULT_TIMEOUT_MS = 45000
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024

function powershellPath() {
  const root = process.env.SystemRoot ?? process.env.WINDIR
  if (root) {
    const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (existsSync(candidate)) return candidate
  }
  return 'powershell.exe'
}

function appProcessName() {
  try {
    const base = basename(process.execPath ?? '')
    return base.toLowerCase().endsWith('.exe') ? base.slice(0, -4) : base
  } catch {
    return ''
  }
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function runProcess(args, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(powershellPath(), args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      outcome()
    }

    const kill = () => {
      try { child.kill() } catch { /* already gone */ }
    }

    const onAbort = () => {
      timedOut = false
      kill()
      const error = new Error('Screenshot capture was cancelled.')
      error.name = 'AbortError'
      finish(() => reject(error))
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
      finish(() => {
        const error = new Error(`Screenshot capture timed out after ${Math.round(timeoutMs / 1000)}s.`)
        error.code = 'CAPTURE_TIMEOUT'
        reject(error)
      })
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk
    })
    child.on('error', (error) => {
      finish(() => reject(error))
    })
    child.on('close', (code) => {
      if (settled) return
      if (timedOut) {
        // The timeout branch already rejected; nothing else to do here.
        return
      }
      finish(() => resolve({ code, stdout, stderr }))
    })
  })
}

function parseResult(stdout) {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith(MARKER)) continue
    const json = line.slice(MARKER.length)
    try {
      return JSON.parse(json)
    } catch {
      return undefined
    }
  }
  return undefined
}

function restoreWindow(pid, processName) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH,
    '-Mode', 'restore',
    '-MaskPid', String(pid),
  ]
  if (processName) args.push('-MaskProcess', processName)
  runProcess(args, { timeoutMs: 15000 }).catch(() => { /* best-effort recovery */ })
}

function regionToString(region) {
  if (!region || typeof region !== 'object') return undefined
  const values = [region.x, region.y, region.width, region.height]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined
  return values.join(',')
}

function clampInteger(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

async function capturePng(ctx, args, exec) {
  if (process.platform !== 'win32') {
    throw new Error('The screenshot tool is available on Windows only.')
  }
  if (!existsSync(SCRIPT_PATH)) {
    throw new Error(`The screenshot helper is missing: ${SCRIPT_PATH}`)
  }

  const mode = args.mode === 'region' || args.mode === 'window' ? args.mode : 'screen'
  const delayMs = clampInteger(args.delay_ms, 0, 10000, 120)
  const maskSelf = args.mask_self === true
  const processName = appProcessName()
  const pid = process.pid
  const fileName = `screenshot-${timestamp()}.png`
  const outPath = join(tmpdir(), `dsh-screenshot-${pid}-${Date.now()}.png`)

  const psArgs = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH,
    '-OutPath', outPath,
    '-Mode', mode,
    '-MaskPid', String(pid),
    '-MaskSelf', maskSelf ? 'true' : 'false',
    '-DelayMs', String(delayMs),
  ]
  if (processName) psArgs.push('-MaskProcess', processName)

  if (mode === 'region') {
    const region = regionToString(args.region)
    if (!region) {
      throw new Error('mode=region requires region {x, y, width, height} with numeric values.')
    }
    if (args.region.width <= 0 || args.region.height <= 0) {
      throw new Error('region.width and region.height must be greater than zero.')
    }
    const unit = args.region.unit === 'percent' ? 'percent' : 'px'
    psArgs.push('-Region', region, '-RegionUnit', unit)
  }
  if (mode === 'window') {
    const selector = typeof args.window === 'string' && args.window.trim() ? args.window.trim() : 'active'
    psArgs.push('-Window', selector)
  }
  if (mode === 'screen' || mode === 'region') {
    const monitor = typeof args.monitor === 'string' && args.monitor.trim() ? args.monitor.trim() : 'all'
    psArgs.push('-Monitor', monitor)
  }

  let result
  try {
    const run = await runProcess(psArgs, { signal: exec?.signal })
    result = parseResult(run.stdout)
    if (!result) {
      const detail = run.stderr.trim() || run.stdout.trim() || `PowerShell exited with code ${run.code}.`
      const error = new Error(`Screenshot helper returned no result. ${detail.slice(0, 800)}`)
      error.code = 'NO_RESULT'
      throw error
    }
    if (result.ok !== true) {
      const code = result.code ? `${result.code}: ` : ''
      const details = result.details?.windows?.length
        ? ` Available windows: ${result.details.windows.join(', ')}.`
        : ''
      throw new Error(`${code}${result.error ?? 'Screenshot capture failed.'}${details}`)
    }
    if (!existsSync(outPath)) {
      throw new Error('Screenshot helper reported success but produced no file.')
    }

    const data = await readFile(outPath)
    if (data.byteLength < 8 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
      throw new Error('Screenshot helper produced an invalid PNG file.')
    }
    const limits = ctx.attachments.imageLimits
    if (Array.isArray(limits.mediaTypes) && !limits.mediaTypes.includes('image/png')) {
      throw new Error('This DSH deployment does not accept PNG images.')
    }
    if (data.byteLength > limits.maxImageBytes) {
      throw new Error(`The screenshot is ${(data.byteLength / 1024 / 1024).toFixed(1)} MB, above the ${(limits.maxImageBytes / 1024 / 1024).toFixed(0)} MB attachment limit.`)
    }

    return { data, result, mode, fileName }
  } catch (error) {
    // If the helper was killed while the harness window was hidden, put it back.
    if (maskSelf && (error.code === 'CAPTURE_TIMEOUT' || error.code === 'NO_RESULT' || error.name === 'AbortError')) {
      restoreWindow(pid, processName)
    }
    throw error
  } finally {
    try { await unlink(outPath) } catch { /* temp file may not exist */ }
  }
}

async function capture(ctx, args, exec) {
  const { data, result, mode, fileName } = await capturePng(ctx, args, exec)
  const attachment = await ctx.attachments.saveImage({
    data,
    mediaType: 'image/png',
    name: fileName,
  })

  let savedTo
  let saveError
  const workspace = exec?.agent?.session?.header?.cwd
  if (args.save_to_workspace !== false && typeof workspace === 'string' && workspace) {
    try {
      const folder = 'screenshots'
      await mkdir(join(workspace, folder), { recursive: true })
      savedTo = join(folder, fileName)
      await writeFile(join(workspace, savedTo), data)
    } catch (error) {
      savedTo = undefined
      saveError = error instanceof Error ? error.message : String(error)
    }
  }

  const attachmentMeta = {
    attachmentId: String(attachment.attachmentId),
    mediaType: attachment.mediaType,
    bytes: typeof attachment.bytes === 'number' ? attachment.bytes : data.byteLength,
    width: attachment.width,
    height: attachment.height,
    ...(attachment.name === undefined ? {} : { name: attachment.name }),
  }

  const captureWidth = typeof result.width === 'number' ? Math.round(result.width) : attachment.width
  const captureHeight = typeof result.height === 'number' ? Math.round(result.height) : attachment.height
  const value = {
    attachment: attachmentMeta,
    width: captureWidth,
    height: captureHeight,
    mode,
    path: savedTo ? join(workspace, savedTo) : '',
    masked: result.masked === true,
  }
  if (savedTo !== undefined) value.savedTo = savedTo
  if (saveError !== undefined) value.saveError = saveError
  if (typeof result.monitor === 'string') value.monitor = result.monitor
  if (typeof result.window?.title === 'string') value.windowTitle = result.window.title
  if (typeof result.window?.process === 'string') value.windowProcess = result.window.process
  if (typeof result.elapsedMs === 'number') value.elapsedMs = Math.round(result.elapsedMs)
  return value
}

function routeFlag(params, name, fallback) {
  const value = params.get(name)
  if (value === null) return fallback
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function routeArgs(req) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const params = url.searchParams
  const requested = params.get('mode')
  const mode = requested === 'region' || requested === 'window' ? requested : 'screen'
  const args = {
    mode,
    mask_self: routeFlag(params, 'mask_self', true),
    delay_ms: Number(params.get('delay_ms') ?? 120),
    save_to_workspace: false,
  }
  if (mode === 'region') {
    const region = params.get('region')
    if (region) {
      const parts = region.split(',').map((part) => Number(part))
      if (parts.length === 4 && parts.every((part) => Number.isFinite(part))) {
        args.region = {
          x: parts[0], y: parts[1], width: parts[2], height: parts[3],
          unit: params.get('unit') === 'percent' ? 'percent' : 'px',
        }
      }
    }
  }
  if (mode === 'window') {
    const window = params.get('window')
    if (window) args.window = window
  }
  const monitor = params.get('monitor')
  if (monitor) args.monitor = monitor
  return args
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

async function listWindows() {
  if (process.platform !== 'win32') throw new Error('Window capture is available on Windows only.')
  if (!existsSync(SCRIPT_PATH)) throw new Error(`The screenshot helper is missing: ${SCRIPT_PATH}`)
  const run = await runProcess([
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH,
    '-Mode', 'list',
  ], { timeoutMs: 15000 })
  const result = parseResult(run.stdout)
  if (!result) {
    const detail = run.stderr.trim() || run.stdout.trim() || `PowerShell exited with code ${run.code}.`
    throw new Error(`Window list failed. ${detail.slice(0, 500)}`)
  }
  if (result.ok !== true) throw new Error(result.error ?? 'Window list failed.')
  return Array.isArray(result.windows) ? result.windows : []
}

async function serveWindows(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    writeJson(res, 405, { error: 'Method not allowed' })
    return
  }
  if (req.headers['x-dsh-screenshot'] !== '1') {
    writeJson(res, 403, { error: 'Forbidden' })
    return
  }
  try {
    writeJson(res, 200, { windows: await listWindows() })
  } catch (error) {
    writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function serveCapture(ctx, req, res) {
  const sendJson = (status, payload) => writeJson(res, status, payload)
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(405, { error: 'Method not allowed' })
    return
  }
  if (req.headers['x-dsh-screenshot'] !== '1') {
    sendJson(403, { error: 'Forbidden' })
    return
  }
  try {
    const { data, result } = await capturePng(ctx, routeArgs(req))
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': data.byteLength,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Screenshot-Width': String(Math.round(result.width ?? 0)),
        'X-Screenshot-Height': String(Math.round(result.height ?? 0)),
        'X-Screenshot-Masked': result.masked === true ? '1' : '0',
      })
    }
    res.end(data)
  } catch (error) {
    if (!res.headersSent) {
      sendJson(500, { error: error instanceof Error ? error.message : String(error) })
    } else {
      res.end()
    }
  }
}

function attachmentContent(ctx, value) {
  const saved = value.path ? ` Saved to ${value.path}.` : ''
  const masked = value.masked ? ' The harness window was masked out.' : ''
  const target = value.mode === 'window' && value.windowTitle
    ? `window "${value.windowTitle}"`
    : value.mode === 'region'
      ? 'region'
      : value.mode === 'window'
        ? 'window'
        : 'screen'
  const hostPath = (() => {
    try {
      return ctx.attachments.imageHostPath(value.attachment)
    } catch {
      return undefined
    }
  })()
  const readable = value.path || hostPath
  const fallback = readable
    ? ` If you cannot view the attached image directly, call modlens_read_image with path "${readable}".`
    : ''
  return [
    {
      type: 'text',
      text: `Captured ${target} at ${value.width}x${value.height}px. The screenshot is attached to this conversation (attachment ID: ${value.attachment.attachmentId}).${masked}${saved}${fallback}`,
    },
    { type: 'image', attachment: value.attachment },
  ]
}

const attachmentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
}

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: CAPTURE_ROUTE,
      handler: (req, res) => { void serveCapture(ctx, req, res) },
    }), 'dsh-screenshot: capture route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: WINDOWS_ROUTE,
      handler: (req, res) => { void serveWindows(req, res) },
    }), 'dsh-screenshot: windows route')
  })

  ctx.effect(() => ctx.tools.register({
    name: 'screenshot',
    description: 'Capture the Windows screen, a region, or a window and attach the PNG to this conversation automatically. Use this whenever the user asks for a screenshot, asks you to look at their screen, or wants you to inspect what is currently visible. The whole flow is automatic: do not ask the user to paste, select, or upload a file. Default: the full virtual desktop (all monitors). Set mask_self=true when the user asks to hide/exclude the DeepSeek Harness window (this chat) so the screenshot shows what is behind it. Set mode=window with a title fragment, process:<name>, pid:<n>, active (foreground window), or self (the harness window) to capture one window. Region coordinates are physical pixels of the virtual desktop; use unit="percent" for percentages. A screenshot that succeeds is already visible in the conversation when this tool returns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['screen', 'region', 'window'],
          description: 'Capture scope. screen = full desktop (default), region = rectangle, window = one window.',
        },
        region: {
          type: 'object',
          additionalProperties: false,
          description: 'Required for mode=region. x/y are the top-left position and width/height the size.',
          properties: {
            x: { type: 'number', description: 'Left edge, in virtual-desktop pixels (may be negative).' },
            y: { type: 'number', description: 'Top edge, in virtual-desktop pixels.' },
            width: { type: 'number', description: 'Width in pixels.' },
            height: { type: 'number', description: 'Height in pixels.' },
            unit: {
              type: 'string',
              enum: ['px', 'percent'],
              description: 'Treat x/y/width/height as pixels (default) or as percentages of the selected monitor.',
            },
          },
          required: ['x', 'y', 'width', 'height'],
        },
        window: {
          type: 'string',
          description: 'For mode=window: part of the window title, process:<name>, pid:<n>, active (foreground window), or self (the DeepSeek Harness window). Defaults to active.',
        },
        monitor: {
          type: 'string',
          description: 'For mode=screen or region: all (default), primary, or a 1-based monitor index such as 2.',
        },
        mask_self: {
          type: 'boolean',
          description: 'Temporarily mask the DeepSeek Harness window so it does not appear in the screenshot. Use when the user asks to exclude this window or to see what is behind it. Default false.',
        },
        delay_ms: {
          type: 'number',
          description: 'Extra settling delay before the capture, in milliseconds (0-10000). Default 120.',
        },
        save_to_workspace: {
          type: 'boolean',
          description: 'Also save the PNG under <workspace>/screenshots. Default true; the image is attached either way.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachment: attachmentSchema,
          width: { type: 'integer' },
          height: { type: 'integer' },
          mode: { type: 'string' },
          path: { type: 'string' },
          savedTo: { type: 'string' },
          saveError: { type: 'string' },
          masked: { type: 'boolean' },
          monitor: { type: 'string' },
          windowTitle: { type: 'string' },
          windowProcess: { type: 'string' },
          elapsedMs: { type: 'integer' },
        },
        required: ['attachment', 'width', 'height', 'mode', 'masked'],
      },
      render: (_args, value) => attachmentContent(ctx, value),
    },
    presentResult: (_args, result) => {
      const images = result.content.filter((block) => block.type === 'image')
      if (images.length === 0) return undefined
      return { card: 'generic', title: 'Screenshot', content: images }
    },
    async execute(args, exec) {
      return capture(ctx, args, exec)
    },
  }))
}
