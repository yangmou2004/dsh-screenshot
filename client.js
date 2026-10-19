window.__ModuleLoader__.load({
  id: 'dsh-screenshot-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-screenshot'
    const CAPTURE_ROUTE = '/plugins/dsh-screenshot/capture'
    const WINDOWS_ROUTE = '/plugins/dsh-screenshot/windows'

    const zh = {
      'button.label': '截图',
      'button.titleSend': '截图并发送（输入框为空）',
      'button.titleAttach': '截图并添加到输入框（有文字，不自动发送）',
      'button.busy': '正在截图…',
      'menu.title': '截图选项',
      'menu.full': '全屏（当前屏幕）',
      'menu.fullSub': '自动屏蔽本窗口',
      'menu.region': '区域（框选）',
      'menu.regionSub': '先截屏，再拖动选择',
      'menu.window': '窗口…',
      'menu.windowSub': '从当前窗口中选择',
      'menu.back': '返回',
      'menu.windowsTitle': '选择窗口',
      'menu.loadingWindows': '正在读取窗口…',
      'menu.noWindows': '没有可截取的窗口',
      'menu.windowError': '读取窗口失败',
      'menu.minimized': '已最小化',
      'crop.title': '拖动选择要截取的区域',
      'crop.hint': '按住鼠标拖动，松开后点击发送',
      'crop.send': '发送截图',
      'crop.sending': '正在发送…',
      'crop.cancel': '取消',
      'error.busy': '输入框正在提交，暂时无法添加截图',
      'error.unavailable': '无法访问对话输入服务',
      'error.capture': '截图失败',
      'error.windows': '读取窗口失败',
    }
    const en = {
      'button.label': 'Screenshot',
      'button.titleSend': 'Capture and send (message box is empty)',
      'button.titleAttach': 'Capture and attach (text present, not sent)',
      'button.busy': 'Capturing…',
      'menu.title': 'Screenshot options',
      'menu.full': 'Full screen',
      'menu.fullSub': 'Hides this window',
      'menu.region': 'Region…',
      'menu.regionSub': 'Capture, then drag to select',
      'menu.window': 'Window…',
      'menu.windowSub': 'Pick a current window',
      'menu.back': 'Back',
      'menu.windowsTitle': 'Choose a window',
      'menu.loadingWindows': 'Loading windows…',
      'menu.noWindows': 'No capturable windows',
      'menu.windowError': 'Could not list windows',
      'menu.minimized': 'minimized',
      'crop.title': 'Drag to select the region to capture',
      'crop.hint': 'Drag with the mouse, then press Send',
      'crop.send': 'Send screenshot',
      'crop.sending': 'Sending…',
      'crop.cancel': 'Cancel',
      'error.busy': 'The composer is busy; try again in a moment',
      'error.unavailable': 'Conversation input service is unavailable',
      'error.capture': 'Screenshot failed',
      'error.windows': 'Could not list windows',
    }

    const style = `
      .dsh-screenshot-split { position: relative; display: inline-flex; align-items: center; gap: 1px; }
      .dsh-screenshot-button {
        width: 27px; height: 28px; flex: 0 0 auto; display: inline-flex;
        align-items: center; justify-content: center; padding: 0;
        border: 1px solid transparent; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        cursor: pointer; transition: background-color 120ms ease, color 120ms ease;
      }
      .dsh-screenshot-chevron {
        width: 14px; height: 28px; flex: 0 0 auto; display: inline-flex;
        align-items: center; justify-content: center; padding: 0;
        border: 1px solid transparent; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-screenshot-button:hover:not(:disabled),
      .dsh-screenshot-chevron:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-screenshot-button:focus-visible,
      .dsh-screenshot-chevron:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dsh-screenshot-button:disabled,
      .dsh-screenshot-chevron:disabled { cursor: default; opacity: .65; }
      .dsh-screenshot-button[data-error="true"] { color: var(--dsw-alias-state-error-primary); }
      .dsh-screenshot-spinner {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid currentColor; border-top-color: transparent;
        animation: dsh-screenshot-spin .8s linear infinite;
      }
      @keyframes dsh-screenshot-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .dsh-screenshot-spinner { animation-duration: 2s; }
      }
      .dsh-screenshot-menu {
        position: absolute; left: 0; bottom: 32px; z-index: 60;
        min-width: 210px; max-width: 290px; padding: 4px;
        background: var(--dsw-alias-bg-overlay);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-screenshot-menu-header {
        display: flex; align-items: center; gap: 6px;
        padding: 3px 4px 5px; font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-screenshot-menu-back {
        border: 0; background: transparent; color: inherit; cursor: pointer;
        padding: 1px 5px; border-radius: 4px; font-size: 14px; line-height: 1;
      }
      .dsh-screenshot-menu-back:hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-screenshot-menu-item {
        display: flex; flex-direction: column; align-items: stretch; width: 100%;
        gap: 1px; padding: 7px 8px; border: 0; border-radius: 7px;
        background: transparent; color: inherit; text-align: left;
        cursor: pointer; font: inherit;
      }
      .dsh-screenshot-menu-item:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dsh-screenshot-menu-item:disabled { opacity: .55; cursor: default; }
      .dsh-screenshot-menu-label { font-size: 12px; line-height: 1.35; }
      .dsh-screenshot-menu-sub {
        font-size: 11px; line-height: 1.35;
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-screenshot-window-list { max-height: 230px; overflow-y: auto; }
      .dsh-screenshot-window-title {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; font-size: 12px; line-height: 1.35;
      }
      .dsh-screenshot-window-sub {
        font-size: 10.5px; line-height: 1.35;
        color: var(--dsw-alias-label-secondary);
      }
      .dsh-screenshot-modal {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .72); padding: 20px;
      }
      .dsh-screenshot-modal-dialog {
        display: flex; flex-direction: column; gap: 10px;
        max-width: 94vw; max-height: 92vh;
      }
      .dsh-screenshot-modal-title {
        color: #fff; font-size: 13px; font-weight: 600; text-align: center;
      }
      .dsh-screenshot-crop-box {
        position: relative; line-height: 0; cursor: crosshair;
        user-select: none; touch-action: none; align-self: center;
      }
      .dsh-screenshot-crop-box img {
        display: block; max-width: 88vw; max-height: 72vh;
        border-radius: 8px; user-select: none; -webkit-user-drag: none;
      }
      .dsh-screenshot-selection {
        position: absolute; border: 2px solid #4ea1ff;
        background: rgba(78, 161, 255, .16); pointer-events: none;
      }
      .dsh-screenshot-modal-meta {
        color: rgba(255, 255, 255, .78); font-size: 12px; text-align: center;
      }
      .dsh-screenshot-modal-error {
        color: #ff9a9a; font-size: 12px; text-align: center;
      }
      .dsh-screenshot-crop-actions {
        display: flex; justify-content: center; gap: 8px;
      }
      .dsh-screenshot-secondary,
      .dsh-screenshot-primary {
        padding: 7px 14px; border-radius: 8px; font: inherit;
        font-size: 12px; cursor: pointer;
      }
      .dsh-screenshot-secondary {
        background: transparent; color: #fff;
        border: 1px solid rgba(255, 255, 255, .3);
      }
      .dsh-screenshot-secondary:hover { background: rgba(255, 255, 255, .1); }
      .dsh-screenshot-primary {
        background: var(--dsw-alias-brand-primary); color: #fff; border: 0;
      }
      .dsh-screenshot-primary:disabled { opacity: .5; cursor: default; }
    `

    const cameraIcon = h('svg', {
      width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
    },
      h('path', { d: 'M4 8V6a2 2 0 0 1 2-2h2' }),
      h('path', { d: 'M16 4h2a2 2 0 0 1 2 2v2' }),
      h('path', { d: 'M20 16v2a2 2 0 0 1-2 2h-2' }),
      h('path', { d: 'M8 20H6a2 2 0 0 1-2-2v-2' }),
      h('circle', { cx: 12, cy: 12, r: 3.4 }),
    )

    const chevronIcon = h('svg', {
      width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
    }, h('path', { d: 'm6 9 6 6 6-6' }))

    let pluginCtx
    let translate = (key) => key

    function stamp() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    }

    function sessionScope(sessionId) {
      try {
        return pluginCtx.sessions.scope(sessionId)
      } catch {
        return undefined
      }
    }

    function conversationFor(sessionId) {
      const scope = sessionScope(sessionId)
      if (scope === undefined) return undefined
      try {
        return { scope, conversation: scope.get('conversation') }
      } catch {
        return undefined
      }
    }

    function notifyError(sessionId, message) {
      try {
        const found = conversationFor(sessionId)
        found?.conversation?.input?.for?.(found.scope)?.notify?.('error', message)
      } catch {
        /* a notice failure must not hide the original error */
      }
    }

    function CropModal({ crop, onCancel, onConfirm }) {
      const imgRef = React.useRef(null)
      const boxRef = React.useRef(null)
      const [selection, setSelection] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      const [loaded, setLoaded] = React.useState(false)
      const [sending, setSending] = React.useState(false)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onCancel() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onCancel])

      const pointOf = (event) => {
        const box = boxRef.current
        if (box === null) return { x: 0, y: 0 }
        const rect = box.getBoundingClientRect()
        const clamp = (value, max) => Math.min(max, Math.max(0, value))
        return {
          x: clamp(event.clientX - rect.left, rect.width),
          y: clamp(event.clientY - rect.top, rect.height),
        }
      }

      const onPointerDown = (event) => {
        if (event.button !== 0 || sending) return
        event.preventDefault()
        try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* optional */ }
        const point = pointOf(event)
        setSelection({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
        setDragging(true)
      }

      const onPointerMove = (event) => {
        if (!dragging) return
        const point = pointOf(event)
        setSelection((current) => current === null ? current : { ...current, x2: point.x, y2: point.y })
      }

      const onPointerUp = (event) => {
        if (!dragging) return
        const point = pointOf(event)
        setSelection((current) => current === null ? current : { ...current, x2: point.x, y2: point.y })
        setDragging(false)
        try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* optional */ }
      }

      const rect = selection === null ? null : {
        left: Math.min(selection.x1, selection.x2),
        top: Math.min(selection.y1, selection.y2),
        width: Math.abs(selection.x2 - selection.x1),
        height: Math.abs(selection.y2 - selection.y1),
      }
      const ready = loaded && rect !== null && rect.width >= 4 && rect.height >= 4 && !sending

      const confirm = async () => {
        if (!ready) return
        const image = imgRef.current
        const box = boxRef.current
        if (image === null || box === null) return
        const boxRect = box.getBoundingClientRect()
        if (boxRect.width <= 0 || boxRect.height <= 0) return
        const naturalWidth = image.naturalWidth || crop.width || boxRect.width
        const naturalHeight = image.naturalHeight || crop.height || boxRect.height
        const scaleX = naturalWidth / boxRect.width
        const scaleY = naturalHeight / boxRect.height
        let sx = Math.max(0, Math.round(rect.left * scaleX))
        let sy = Math.max(0, Math.round(rect.top * scaleY))
        let sw = Math.max(1, Math.round(rect.width * scaleX))
        let sh = Math.max(1, Math.round(rect.height * scaleY))
        sw = Math.min(sw, naturalWidth - sx)
        sh = Math.min(sh, naturalHeight - sy)
        if (sw < 1 || sh < 1) return
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        const context = canvas.getContext('2d')
        if (context === null) return
        context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
        setSending(true)
        setError('')
        canvas.toBlob((blob) => {
          if (blob === null) {
            setSending(false)
            setError(translate('error.capture'))
            return
          }
          Promise.resolve(onConfirm(blob)).catch((failure) => {
            setSending(false)
            setError(failure instanceof Error ? failure.message : String(failure))
          })
        }, 'image/png')
      }

      return h('div', {
        className: 'dsh-screenshot-modal',
        onClick: onCancel,
      },
        h('div', {
          className: 'dsh-screenshot-modal-dialog',
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'dsh-screenshot-modal-title' }, translate('crop.title')),
          h('div', {
            className: 'dsh-screenshot-crop-box',
            ref: boxRef,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
          },
            h('img', {
              ref: imgRef,
              src: crop.url,
              alt: '',
              draggable: false,
              onLoad: () => setLoaded(true),
            }),
            rect === null ? null : h('div', {
              className: 'dsh-screenshot-selection',
              style: {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              },
            }),
          ),
          h('div', { className: 'dsh-screenshot-modal-meta' }, translate('crop.hint')),
          error === '' ? null : h('div', { className: 'dsh-screenshot-modal-error' }, error),
          h('div', { className: 'dsh-screenshot-crop-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-screenshot-secondary',
              onClick: onCancel,
            }, translate('crop.cancel')),
            h('button', {
              type: 'button',
              className: 'dsh-screenshot-primary',
              disabled: !ready,
              onClick: confirm,
            }, sending ? translate('crop.sending') : translate('crop.send')),
          ),
        ),
      )
    }

    function ScreenshotButton(props) {
      const { inputActions, sessionId, useInput } = props
      const draft = useInput((state) => state.draft)
      const draftRef = React.useRef(draft)
      draftRef.current = draft
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [menuView, setMenuView] = React.useState('root')
      const [windows, setWindows] = React.useState(null)
      const [windowsLoading, setWindowsLoading] = React.useState(false)
      const [windowsError, setWindowsError] = React.useState('')
      const [crop, setCrop] = React.useState(null)
      const lock = React.useRef(false)
      const wrapRef = React.useRef(null)
      const cropUrlRef = React.useRef(null)

      React.useEffect(() => () => {
        if (cropUrlRef.current !== null) URL.revokeObjectURL(cropUrlRef.current)
      }, [])

      React.useEffect(() => {
        if (!menuOpen) return undefined
        const onPointer = (event) => {
          if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) {
            setMenuOpen(false)
            setMenuView('root')
          }
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setMenuOpen(false)
            setMenuView('root')
          }
        }
        document.addEventListener('pointerdown', onPointer)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onPointer)
          document.removeEventListener('keydown', onKey)
        }
      }, [menuOpen])

      const closeCrop = () => {
        if (cropUrlRef.current !== null) {
          URL.revokeObjectURL(cropUrlRef.current)
          cropUrlRef.current = null
        }
        setCrop(null)
      }

      const openCrop = (blob, width, height) => {
        if (cropUrlRef.current !== null) URL.revokeObjectURL(cropUrlRef.current)
        const url = URL.createObjectURL(blob)
        cropUrlRef.current = url
        setCrop({ url, width, height })
      }

      const captureBlob = async (query) => {
        const response = await fetch(`${CAPTURE_ROUTE}?${query}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-DSH-Screenshot': '1' },
        })
        if (!response.ok) {
          let message = `${translate('error.capture')} (${response.status})`
          try {
            const body = await response.json()
            if (typeof body?.error === 'string' && body.error) message = body.error
          } catch {
            /* keep the status message */
          }
          throw new Error(message)
        }
        const blob = await response.blob()
        if (blob.size === 0) throw new Error(translate('error.capture'))
        return {
          blob,
          width: Number(response.headers.get('X-Screenshot-Width')) || 0,
          height: Number(response.headers.get('X-Screenshot-Height')) || 0,
        }
      }

      const deliver = async (blob) => {
        const file = new File([blob], `screenshot-${stamp()}.png`, { type: 'image/png' })
        const found = conversationFor(sessionId)
        const conversation = found?.conversation
        if (conversation === undefined
          || typeof conversation.createDrafts !== 'function'
          || typeof conversation.releaseDraftAttachments !== 'function') {
          throw new Error(translate('error.unavailable'))
        }
        const drafts = conversation.createDrafts(sessionId, [file])
        const ids = drafts.map((item) => item.id)
        if (!inputActions.addAttachments(ids)) {
          conversation.releaseDraftAttachments(drafts)
          throw new Error(translate('error.busy'))
        }
        if (draftRef.current.trim() === '' && typeof inputActions.submit === 'function') {
          // Empty composer: one click sends the screenshot.
          await new Promise((resolve) => setTimeout(resolve, 0))
          inputActions.submit()
        } else {
          // Text present: only attach, so the user can send text + screenshot together.
          try {
            conversation.input?.for?.(found.scope)?.focus?.()
          } catch {
            /* focus is a convenience */
          }
        }
      }

      const report = (failure) => {
        const message = failure instanceof Error ? failure.message : String(failure)
        setError(message)
        notifyError(sessionId, message)
      }

      const run = async (query, after) => {
        if (lock.current) return
        if (inputActions === undefined) {
          setError(translate('error.unavailable'))
          return
        }
        lock.current = true
        setBusy(true)
        setError('')
        setMenuOpen(false)
        try {
          const shot = await captureBlob(query)
          if (typeof after === 'function') await after(shot)
          else await deliver(shot.blob)
        } catch (failure) {
          report(failure)
        } finally {
          lock.current = false
          setBusy(false)
        }
      }

      const sendCrop = async (blob) => {
        closeCrop()
        if (lock.current) return
        lock.current = true
        setBusy(true)
        setError('')
        try {
          await deliver(blob)
        } catch (failure) {
          report(failure)
        } finally {
          lock.current = false
          setBusy(false)
        }
      }

      const loadWindows = async () => {
        setWindowsLoading(true)
        setWindowsError('')
        try {
          const response = await fetch(WINDOWS_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-DSH-Screenshot': '1' },
          })
          if (!response.ok) {
            let message = `${translate('error.windows')} (${response.status})`
            try {
              const body = await response.json()
              if (typeof body?.error === 'string' && body.error) message = body.error
            } catch {
              /* keep the status message */
            }
            throw new Error(message)
          }
          const data = await response.json()
          setWindows(Array.isArray(data.windows) ? data.windows : [])
        } catch (failure) {
          setWindowsError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setWindowsLoading(false)
        }
      }

      const toggleMenu = () => {
        if (busy) return
        setError('')
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        setMenuView('root')
        setWindows(null)
        setWindowsError('')
        setMenuOpen(true)
      }

      const chooseWindow = (item) => {
        setMenuOpen(false)
        setMenuView('root')
        void run(`mode=window&window=${encodeURIComponent(`hwnd:${item.hwnd}`)}&mask_self=1`)
      }

      const menuItem = (key, label, sub, onClick) => h('button', {
        key,
        type: 'button',
        role: 'menuitem',
        className: 'dsh-screenshot-menu-item',
        onClick,
      },
        h('span', { className: 'dsh-screenshot-menu-label' }, label),
        sub === undefined ? null : h('span', { className: 'dsh-screenshot-menu-sub' }, sub),
      )

      let menu = null
      if (menuOpen) {
        if (menuView === 'windows') {
          let body
          if (windowsLoading) {
            body = h('div', { className: 'dsh-screenshot-menu-sub', style: { padding: '8px' } }, translate('menu.loadingWindows'))
          } else if (windowsError !== '') {
            body = h('div', { className: 'dsh-screenshot-menu-sub', style: { padding: '8px' } }, windowsError)
          } else if (windows !== null && windows.length === 0) {
            body = h('div', { className: 'dsh-screenshot-menu-sub', style: { padding: '8px' } }, translate('menu.noWindows'))
          } else {
            body = h('div', { className: 'dsh-screenshot-window-list' }, (windows ?? []).map((item) => h('button', {
              key: String(item.hwnd),
              type: 'button',
              role: 'menuitem',
              className: 'dsh-screenshot-menu-item',
              title: item.title,
              onClick: () => chooseWindow(item),
            },
              h('span', { className: 'dsh-screenshot-window-title' }, item.title || '(untitled)'),
              h('span', { className: 'dsh-screenshot-window-sub' },
                [item.process, item.iconic ? translate('menu.minimized') : ''].filter(Boolean).join(' · ')),
            )))
          }
          menu = h('div', { className: 'dsh-screenshot-menu', role: 'menu' },
            h('div', { className: 'dsh-screenshot-menu-header' },
              h('button', {
                type: 'button',
                className: 'dsh-screenshot-menu-back',
                title: translate('menu.back'),
                onClick: () => setMenuView('root'),
              }, '←'),
              h('span', null, translate('menu.windowsTitle')),
            ),
            body,
          )
        } else {
          menu = h('div', { className: 'dsh-screenshot-menu', role: 'menu' },
            menuItem('full', translate('menu.full'), translate('menu.fullSub'), () => {
              void run('mode=screen&mask_self=1')
            }),
            menuItem('region', translate('menu.region'), translate('menu.regionSub'), () => {
              void run('mode=screen&mask_self=1', (shot) => {
                openCrop(shot.blob, shot.width, shot.height)
              })
            }),
            menuItem('window', translate('menu.window'), translate('menu.windowSub'), () => {
              setMenuView('windows')
              if (windows === null) void loadWindows()
            }),
          )
        }
      }

      const title = error !== ''
        ? error
        : busy
          ? translate('button.busy')
          : draft.trim() !== ''
            ? translate('button.titleAttach')
            : translate('button.titleSend')

      return h(React.Fragment, null,
        h('style', { key: 'style' }, style),
        h('span', { key: 'split', className: 'dsh-screenshot-split', ref: wrapRef },
          h('button', {
            type: 'button',
            className: 'dsh-screenshot-button',
            title,
            'aria-label': translate('button.label'),
            'aria-busy': busy || undefined,
            'data-error': error !== '' ? 'true' : undefined,
            disabled: busy,
            onClick: () => { void run('mode=screen&mask_self=1') },
          }, busy
            ? h('span', { className: 'dsh-screenshot-spinner' })
            : cameraIcon),
          h('button', {
            type: 'button',
            className: 'dsh-screenshot-chevron',
            title: translate('menu.title'),
            'aria-label': translate('menu.title'),
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen,
            disabled: busy,
            onClick: toggleMenu,
          }, chevronIcon),
          menu,
        ),
        crop === null ? null : h(CropModal, {
          key: 'crop',
          crop,
          onCancel: closeCrop,
          onConfirm: sendCrop,
        }),
      )
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply(ctx) {
        pluginCtx = ctx
        ctx.effect(() => {
          const disposeZh = ctx.locale.register(NS, 'zh', zh)
          const disposeEn = ctx.locale.register(NS, 'en', en)
          return () => { disposeZh(); disposeEn() }
        }, 'dsh-screenshot: dictionaries')
        translate = ctx.locale.bind(NS)
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'screenshot',
          order: 5,
        }, ScreenshotButton))
      },
    }
  },
})
