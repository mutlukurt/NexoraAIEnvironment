import { app, BrowserWindow, shell, ipcMain, dialog, type IpcMainInvokeEvent } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import {
  loadModel,
  unloadModel,
  resetSession,
  chat,
  abortChat,
  isModelLoaded,
  getLoadedInfo,
  setCustomSystemPrompt,
  disposeWorker,
  getActiveFamily,
  debugHasFamilyNote,
  generateForServe,
  getLastTurnUsage,
  getLastTurnInspection,
  imageToDataUrl
} from './llamaService'
import {
  searchModels,
  listLocalModels,
  deleteLocalModel,
  downloadModel,
  cancelDownload
} from './hfService'
import {
  runCommand,
  fetchToFile,
  addGoogleFont,
  syncWorkspace,
  rescanWorkspace,
  startDev,
  stopDev,
  getDevUrl,
  exportProject,
  exportProjectZipBytes,
  buildCheck,
  startRuntimeCollector,
  setRuntimeErrorCallback,
  runtimeCollectorPort,
  importProjectFolder,
  appendRepairLog,
  readRepairStats,
  listProjects,
  openProjectDir
} from './agentService'
import { runBenchmark, readBenchmarks } from './benchService'
import { loadSemanticIndex, saveSemanticIndex } from './semanticIndexStore'
import { inspectRuntimeException } from './debugInspect'
import { runBehaviorTest } from './behaviorTest'
import { reproCheck } from './reproCheck'
import { analyzeImage, stopVisionServer, ensureVisionReady, scanInstalledVisionModels } from './visionService'
import { detectHardware, getAdvisorPlan } from './advisorService'
import { setApiConfig, promptApi, hasApiOverride, generateImage, type ApiConfig } from './apiEngine'
import { writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { listSessions, saveSession, loadSession, deleteSession } from './sessionsService'
import { saveArtifactDoc, listArtifactDocs, readArtifactDoc } from './artifactDocsService'
import {
  learnKnowledge,
  listKnowledge,
  readKnowledge,
  deleteKnowledge,
  retireKnowledgeBySig,
  knowledgeContext
} from './knowledgeService'
import { getGlobalRules, setGlobalRules, getMergedRules } from './rulesService'
import { getRules, setRules } from './rulesService'
import { historyCommit, historyList, historyRestore, historyRestoreGreen, historyFilesAt } from './gitService'
import { capturePage } from './captureService'
import {
  getServers as mcpGetServers,
  callTool as mcpCallTool,
  reload as mcpReload,
  readConfig as mcpReadConfig,
  writeConfig as mcpWriteConfig,
  configPath as mcpConfigPath,
  shutdown as mcpShutdown,
  setLifecycleAuthorized as mcpSetLifecycleAuthorized
} from './mcpService'
import { startServe, stopServe, serveStatus } from './serveEngine'
import { registerSidecarStop, stopAllSidecars } from './sidecarLifecycle'
import { setupTray, disposeTray, setKeepAwake, showNotification } from './systemIntegration'
import { globalSearch } from './searchService'
import { listCommands } from './commandsService'
import { activateProvider, fetchProviderModels, setActiveModel, clearActiveModel } from './providersService'
import { setProviderKey, deleteProviderKey, listConfiguredProviders } from './providerKeysService'
import {
  recordChange as histRecord,
  recordDecision as histDecision,
  seedOverview as histSeed,
  recordModelSwitch as histSwitch,
  getHistoryRaw,
  setHistoryRaw,
  historyContext
} from './historyService'
import {
  IPC,
  type ChatSendInput,
  type HfDownloadInput,
  type ArtifactExportInput,
  type AgentRunInput,
  type AgentFetchInput,
  type AgentFontInput,
  type AgentDevInput,
  type SessionData,
  type McpCallInput,
  type McpServerConfigInput
} from '../shared/ipc'
import {
  authorizeNativeCapability,
  type NativeCapabilityEffect
} from '../shared/nativeCapabilityApproval'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Inference ayrı bir Node worker sürecinde koştuğu için (bkz. llamaWorker.ts)
// buradaki eski agresif GPU/Vulkan kapatma bayraklarına gerek kalmadı; üstelik
// use-gl=swiftshader + disable-software-rasterizer ikilisi Electron 43'te
// Wayland altında hiç kare üretmiyor ve pencere hiç görünmüyordu.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

if (process.env['NEXORA_HEADLESS']) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('no-sandbox')
}

// Opt-in canlı-test/hata-ayıklama: NEXORA_CDP=<port> ile Chrome DevTools Protocol'ü aç
// (yalnız geliştirici bu env'i verirse; normal kullanıcıda kapalı). Motor/UI'yi
// dışarıdan sürebilmek için (CDP eval), üretimde kapalı.
if (process.env['NEXORA_CDP']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['NEXORA_CDP'])
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

let mainWindow: BrowserWindow | null = null
/** The UI inference engine is single-flight; every event is request-scoped. */
let activeChatRequestId: string | null = null
const approvedExternalPaths = new Set<string>()
const approvedExternalDirectories = new Set<string>()

function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id
}

function escapeConfirmationHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]!)
}

let privilegedConfirmationTail: Promise<void> = Promise.resolve()

/** Main-owned final authority for process, network and MCP effects. Renderer
 * approval flags are never sufficient: the exact frozen effect is shown in a
 * preload-free sandboxed modal and executed immediately by the same handler.
 * The modal is used instead of Electron's platform message box because GTK can
 * focus the affirmative action even when Electron requests a deny default. */
function confirmNativeCapability(effect: Readonly<NativeCapabilityEffect>, policyReason: string): Promise<boolean> {
  const run = privilegedConfirmationTail.then(() => new Promise<boolean>((resolveConfirmation) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolveConfirmation(false)
    const modal = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      show: false,
      width: 680,
      height: 560,
      minWidth: 560,
      minHeight: 460,
      title: 'Approve privileged action',
      autoHideMenuBar: true,
      backgroundColor: '#111827',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'nexora-privileged-confirmation'
      }
    })
    let settled = false
    const settle = (allowed: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(safetyTimer)
      resolveConfirmation(allowed)
      if (!modal.isDestroyed()) modal.destroy()
    }
    // FAIL-SAFE: if the confirmation surface can't be shown or answered, DENY
    // (never hang). Without these, a failed data-URL load / crashed renderer left
    // an invisible modal whose promise never resolved — freezing the agent turn
    // and every serialized confirmation behind it.
    const safetyTimer = setTimeout(() => settle(false), 180_000)
    modal.on('closed', () => settle(false))
    modal.webContents.on('did-fail-load', () => settle(false))
    modal.webContents.on('render-process-gone', () => settle(false))
    modal.webContents.on('unresponsive', () => settle(false))
    modal.on('page-title-updated', (event, title) => {
      if (title !== 'NEXORA_ALLOW' && title !== 'NEXORA_DENY') return
      event.preventDefault()
      settle(title === 'NEXORA_ALLOW')
    })
    modal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    modal.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    modal.webContents.on('will-navigate', (event) => event.preventDefault())
    modal.webContents.once('did-finish-load', () => {
      if (!modal.isDestroyed()) {
        modal.show()
        modal.focus()
        modal.webContents.focus()
      }
    })
    const detail = escapeConfirmationHtml(effect.detail.slice(0, 4000))
    const project = escapeConfirmationHtml(effect.projectName || '(no project)')
    const capability = escapeConfirmationHtml(effect.capability)
    const reason = escapeConfirmationHtml(policyReason)
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Approve privileged action</title><style>
      :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#111827;color:#f9fafb;padding:28px}main{max-width:620px;margin:auto}h1{font-size:22px;margin:0 0 8px}.badge{display:inline-block;padding:4px 9px;border-radius:999px;background:#7c2d12;color:#fed7aa;font:700 12px ui-monospace,monospace}.meta{margin:18px 0 8px;color:#9ca3af;font-size:13px}.detail,.policy{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #374151;border-radius:10px;padding:14px;background:#0b1220;font:13px/1.5 ui-monospace,monospace}.policy{margin-top:12px;color:#d1d5db}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}button{border:1px solid #4b5563;border-radius:9px;padding:10px 18px;background:#1f2937;color:#fff;font-weight:700;cursor:pointer}button:focus{outline:3px solid #f59e0b;outline-offset:2px}button.allow{background:#b45309;border-color:#f59e0b}
    </style></head><body><main><span class="badge">${capability}</span><h1>Approve this exact action once?</h1><p class="meta">Project: ${project}</p><div class="detail">${detail}</div><div class="policy">Policy: ${reason}</div><div class="actions"><button id="deny" autofocus onclick="document.title='NEXORA_DENY'">Deny</button><button class="allow" onclick="document.title='NEXORA_ALLOW'">Allow once</button></div></main><script>addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();document.title='NEXORA_DENY'}});document.getElementById('deny').focus()</script></body></html>`
    void modal.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  }))
  privilegedConfirmationTail = run.then(() => undefined, () => undefined)
  return run
}

async function confirmDirectPrivilegedEffect(
  event: IpcMainInvokeEvent,
  effect: NativeCapabilityEffect,
  policyReason: string
): Promise<boolean> {
  if (!isTrustedIpcSender(event)) return false
  return confirmNativeCapability(Object.freeze({ ...effect }), policyReason)
}

function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  } catch {
    return false
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function isManagedStoragePath(raw: string): boolean {
  if (!raw) return false
  const roots = [join(homedir(), 'NexoraAI')]
  const realHome = process.env.SNAP_REAL_HOME
  if (realHome) roots.push(join(realHome, 'NexoraAI'))
  return roots.some((root) => isWithin(root, raw))
}

function isApprovedExternalPath(raw: string): boolean {
  const target = resolve(raw)
  return approvedExternalPaths.has(target) || [...approvedExternalDirectories].some((dir) => isWithin(dir, target))
}

function createWindow(): void {
  const win = new BrowserWindow({
    title: 'NexoraAI',
    icon: join(__dirname, '../renderer/logo.png'),
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--nexora-home=${encodeURIComponent(homedir())}`]
    }
  })

  mainWindow = win

  // 20.3 — mikrofon (dikte) izni: yalnız 'media' (getUserMedia audio) verilir; ses
  // cihazda kalır, whisper.cpp offline yazıya çevirir. Diğer tüm izinler reddedilir.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  // ready-to-show ilk boyamaya bağlıdır; GPU/compositor aksarsa hiç ateşlenmeyebilir.
  // Pencere hiçbir koşulda gizli kalmasın diye kısa bir emniyet zamanlayıcısı var.
  const showFallback = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show()
      console.log('[NexoraAI] window shown via fallback timer')
    }
  }, 2500)

  win.on('ready-to-show', () => {
    clearTimeout(showFallback)
    if (!win.isDestroyed() && !win.isVisible()) win.show()
    console.log('[NexoraAI] window ready, platform=' + process.platform)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void (async () => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
      const allowed = await confirmNativeCapability(
        { capability: 'network', projectName: '', detail: `Open in the system browser:\n${parsed.href}` },
        'External navigation leaves NexoraAI and may disclose data to another site.'
      )
      if (allowed) await shell.openExternal(parsed.href)
    })()
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.MODEL_SELECT, async () => {
    const res = await dialog.showOpenDialog({
      title: 'GGUF modeli seç',
      properties: ['openFile'],
      filters: [{ name: 'GGUF Model', extensions: ['gguf'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    approvedExternalPaths.add(resolve(res.filePaths[0]))
    return { path: res.filePaths[0] }
  })

  ipcMain.handle(IPC.MODEL_LOAD, async (event, path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') => {
    try {
      const modelPath = resolve(String(path ?? ''))
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'external-read', projectName: '', detail: `Load and execute model file:\n${modelPath}\nGPU: ${enableGpu === false ? 'disabled' : 'enabled/automatic'}\nGPU layers: ${String(gpuLayers ?? 'automatic')}` },
        'Model loading starts native inference code and may download the fixed llama.cpp runtime when missing.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      approvedExternalPaths.add(modelPath)
      let lastSent = 0
      const info = await loadModel(modelPath, enableGpu, gpuLayers, (stage, progress) => {
        // ~60ms throttle: onLoadProgress fires per-tensor and would flood IPC.
        const now = Date.now()
        if (progress < 1 && now - lastSent < 60) return
        lastSent = now
        mainWindow?.webContents.send(IPC.MODEL_LOAD_PROGRESS, { stage, progress })
      })
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.MODEL_UNLOAD, async () => {
    await unloadModel()
    return { ok: true }
  })

  ipcMain.handle(IPC.MODEL_STATUS, async () => {
    const info = getLoadedInfo()
    if (!isModelLoaded() || !info) return { loaded: false }
    return { loaded: true, info }
  })

  ipcMain.handle(IPC.MODEL_SET_SYSTEM_PROMPT, async (_e, prompt: string) => {
    setCustomSystemPrompt(prompt)
    if (isModelLoaded()) {
      await resetSession()
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.MODEL_SET_API_CONFIG, async (event, config: Partial<ApiConfig>) => {
    const frozen = Object.freeze({
      baseUrl: String(config.baseUrl ?? '').trim(),
      apiKey: String(config.apiKey ?? ''),
      model: String(config.model ?? '').trim(),
      mode: config.mode === 'fix' || config.mode === 'all' ? config.mode : 'off' as const
    })
    if (frozen.mode !== 'off') {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'credential', projectName: '', detail: `Enable remote API route:\n${frozen.baseUrl}\nModel: ${frozen.model}\nMode: ${frozen.mode}\nAPI key: ${frozen.apiKey ? '(provided; value hidden)' : '(none)'}` },
        'Remote API routing can send prompts, code, and optional images off-device.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
    }
    setApiConfig(frozen)
    return { ok: true }
  })

  // 22.1 — Turbo (speculative decoding): flag'i AYARLA; sunucu YENİDEN SPAWN olurken
  // (model yükleme) --model-draft eklenir. Renderer yükleme öncesi + toggle'da çağırır.
  ipcMain.handle(IPC.MODEL_SET_TURBO, async (_e, enabled: boolean) => {
    try {
      const eng = await import('./llamaServerEngine')
      eng.setTurboDraft(!!enabled)
      return { ok: true, enabled: !!enabled }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 22.1 — Turbo durumu: açık mı + son spawn'da fiilen seçilen draft (yoksa null).
  ipcMain.handle(IPC.MODEL_TURBO_STATUS, async () => {
    try {
      const eng = await import('./llamaServerEngine')
      return { ok: true, ...eng.getTurboStatus() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.CHAT_NEW, async () => {
    if (activeChatRequestId) {
      await abortChat()
      activeChatRequestId = null
    }
    await resetSession({ resetProfile: true })
    return { ok: true }
  })

  ipcMain.handle(IPC.CHAT_SEND, async (event, input: ChatSendInput) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    const imagePath = input.imagePath ? resolve(String(input.imagePath)) : undefined
    if (imagePath && !isManagedStoragePath(imagePath) && !isApprovedExternalPath(imagePath)) {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'external-read', projectName: '', detail: `Attach this external image to the chat request:\n${imagePath}` },
        'The image will be read by native code and may be sent to an already-authorized remote model route.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      approvedExternalPaths.add(imagePath)
    }
    const frozenInput: ChatSendInput = Object.freeze({ ...input, imagePath })
    const requestId =
      typeof frozenInput?.requestId === 'string' && frozenInput.requestId.trim()
        ? frozenInput.requestId.trim().slice(0, 120)
        : randomUUID()
    if (activeChatRequestId && activeChatRequestId !== requestId) {
      return { ok: false, requestId, error: 'another chat request is still active' }
    }
    activeChatRequestId = requestId
    try {
      const full = await chat(frozenInput, (token) => {
        if (activeChatRequestId === requestId) {
          mainWindow?.webContents.send(IPC.CHAT_STREAM, { requestId, token, done: false })
        }
      })
      if (activeChatRequestId !== requestId) return { ok: false, requestId, error: 'request superseded' }
      // 10.12.2: turun token kullanımını done olayıyla ilet (motor usage'ı / tahmin).
      mainWindow.webContents.send(IPC.CHAT_STREAM, { requestId, done: true, full, usage: getLastTurnUsage(), inspection: getLastTurnInspection() })
      // send() synchronously queues the completion event; release the slot only
      // after that queueing step so no second IPC request can overtake done.
      activeChatRequestId = null
      return { ok: true, requestId }
    } catch (err) {
      return { ok: false, requestId, error: (err as Error).message }
    } finally {
      if (activeChatRequestId === requestId) activeChatRequestId = null
    }
  })

  ipcMain.handle(IPC.CHAT_ABORT, async (_e, requestId?: string) => {
    if (requestId && activeChatRequestId && requestId !== activeChatRequestId) {
      return { ok: true, ignored: true }
    }
    await abortChat()
    activeChatRequestId = null
    return { ok: true }
  })

  // Faz 13 — yerel motor geçmişini UI sohbetiyle tohumla: farklı bir model
  // yüklenince / oturum açılınca yeni model önceki konuşmayı bilsin.
  ipcMain.handle(IPC.CHAT_SEED_HISTORY, async (_e, turns: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    if (!Array.isArray(turns)) return { ok: false }
    const safe = turns
      .filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
      .slice(-100)
      .map((t) => ({ role: t.role, content: t.content.slice(0, 6000) }))
    const { seedEngineHistory } = await import('./llamaService')
    seedEngineHistory(safe)
    return { ok: true }
  })

  // 14.3 — yerel embed sidecar (opt-in): semantik [SEARCH] katmanı.
  ipcMain.handle(IPC.EMBED_HAS, async () => {
    const { hasEmbedModel } = await import('./localEmbedService')
    return { has: hasEmbedModel() }
  })
  ipcMain.handle(IPC.EMBED_EMBED, async (_e, texts: string[]) => {
    if (!Array.isArray(texts)) return { ok: false, error: 'geçersiz girdi' }
    const { embed } = await import('./localEmbedService')
    return embed(texts.slice(0, 256).map((t) => String(t)))
  })

  // 14.5 — genel tek-atış model completion (Intent Gate + gelecek meta-geçişler).
  // Yerel model yüklüyse ONUNLA (yalıtık), yoksa aktif API modeliyle; ikisi de
  // yoksa {ok:false}. Kısa, deterministik-eğilimli (düşük sıcaklık).
  ipcMain.handle(IPC.MODEL_COMPLETE, async (_e, input: { prompt: string; maxTokens?: number; system?: string }) => {
    const prompt = String(input?.prompt ?? '')
    if (!prompt.trim()) return { ok: false, error: 'boş prompt' }
    const maxTokens = Math.min(Math.max(input?.maxTokens ?? 400, 32), 2048)
    try {
      const svc = await import('./llamaService')
      if (svc.isModelLoaded()) {
        const text = await svc.generateForServe(prompt, { maxTokens, temperature: 0.2 }, () => undefined)
        return { ok: true, text }
      }
      const api = await import('./apiEngine')
      if (api.hasApiOverride()) {
        const text = await api.promptApi(input?.system ?? 'You are a precise assistant. Follow the instructions exactly.', prompt, () => undefined, undefined, { maxTokens })
        return { ok: true, text }
      }
      return { ok: false, error: 'model yok' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_SEARCH, async (event, query: string) => {
    try {
      const frozenQuery = String(query ?? '').trim().slice(0, 300)
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'network', projectName: '', detail: `Search Hugging Face for:\n${frozenQuery}` },
        'This sends the search query to Hugging Face.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      return { ok: true, results: await searchModels(frozenQuery) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_LIST_LOCAL, async (event, dir: string) => {
    try {
      const target = resolve(String(dir ?? ''))
      if (!isManagedStoragePath(target) && !isApprovedExternalPath(target)) {
        const allowed = await confirmDirectPrivilegedEffect(
          event,
          { capability: 'external-read', projectName: '', detail: `List local models in:\n${target}` },
          'This reads an external directory chosen outside NexoraAI managed storage.'
        )
        if (!allowed) return { ok: false, error: 'Native approval denied.' }
        approvedExternalDirectories.add(target)
      }
      return { ok: true, models: await listLocalModels(target) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_DELETE_LOCAL, async (event, dir: string, name: string) => {
    const target = resolve(String(dir ?? ''), String(name ?? ''))
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'external-write', projectName: '', detail: `Permanently delete local model:\n${target}` },
      'Deleting a model is an irreversible filesystem operation.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    return deleteLocalModel(resolve(String(dir ?? '')), String(name ?? ''))
  })

  ipcMain.handle(IPC.HF_SELECT_DIR, async () => {
    const res = await dialog.showOpenDialog({
      title: 'İndirme dizini seç',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false }
    approvedExternalDirectories.add(resolve(res.filePaths[0]))
    return { ok: true, dir: res.filePaths[0] }
  })

  ipcMain.handle(IPC.HF_DOWNLOAD, async (event, input: HfDownloadInput) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    try {
      const frozen = Object.freeze({ repo: String(input.repo ?? ''), file: String(input.file ?? ''), dir: resolve(String(input.dir ?? '')) })
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'network', projectName: '', detail: `Download model:\n${frozen.repo}/${frozen.file}\nDestination: ${frozen.dir}` },
        'This downloads remote content and writes it to disk.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      const uri = `hf:${frozen.repo}/${frozen.file}`
      const modelPath = await downloadModel(uri, frozen.dir, (downloaded, total) => {
        mainWindow?.webContents.send(IPC.HF_PROGRESS, {
          file: frozen.file,
          downloaded,
          total,
          done: false
        })
      })
      mainWindow.webContents.send(IPC.HF_PROGRESS, { file: frozen.file, done: true, total: 0, downloaded: 0 })
      return { ok: true, modelPath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_CANCEL, async () => {
    await cancelDownload()
    return { ok: true }
  })

  ipcMain.handle(IPC.ARTIFACTS_EXPORT, async (_e, input: ArtifactExportInput) => {
    try {
      const res = await dialog.showOpenDialog({
        title: 'Projenin kaydedileceği dizini seç',
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'İptal edildi' }
      }
      // Profesyonel dışa aktarma: <seçilen>/<proje-adı>/ altına scaffold'lu tam
      // proje + çalışma alanındaki indirilen varlıklar (font/görsel) birlikte.
      return await exportProject(input.projectName ?? 'nexora-projesi', input.files, res.filePaths[0])
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    IPC.ARTIFACTS_EXPORT_ZIP,
    async (_e, input: { files: Array<{ path: string; content: string }>; projectName?: string }) => {
      try {
        const name = input.projectName ?? 'nexora-projesi'
        const built = await exportProjectZipBytes(name, input.files)
        if (!built.ok || !built.bytes) return { ok: false, error: built.error ?? 'zip oluşturulamadı' }
        const res = await dialog.showSaveDialog({
          title: 'Projeyi .zip olarak kaydet',
          defaultPath: `${built.slug ?? 'proje'}.zip`,
          filters: [{ name: 'ZIP', extensions: ['zip'] }]
        })
        if (res.canceled || !res.filePath) return { ok: false, canceled: true }
        const target = res.filePath
        await writeFile(target, Buffer.from(built.bytes))
        return { ok: true, path: target, count: built.count }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.AGENT_RUN, async (event, input: AgentRunInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, output: 'untrusted IPC sender', exitCode: null }
    const frozen: AgentRunInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      command: String(input.command ?? '').trim(),
      files: (input.files ?? []).map((file) => ({ path: String(file.path), content: String(file.content) }))
    })
    const authorization = await authorizeNativeCapability(
      { capability: 'run', projectName: frozen.projectName, command: frozen.command, detail: frozen.command },
      frozen.authorization,
      confirmNativeCapability
    )
    if (!authorization.allowed) {
      return { ok: false, output: authorization.reason, exitCode: null }
    }
    await syncWorkspace(frozen.projectName, frozen.files)
    // 7.6 görünür terminal: execId verildiyse çıktı canlı olaylarla akar.
    const execId = frozen.execId
    const emit = (ev: Record<string, unknown>) => mainWindow?.webContents.send(IPC.TERM_OUTPUT, ev)
    const started = Date.now()
    const res = await runCommand(
      frozen.projectName,
      frozen.command,
      undefined,
      execId ? (chunk) => emit({ execId, chunk }) : undefined
    )
    if (execId) emit({ execId, done: true, ok: res.ok, exitCode: res.exitCode, durationMs: Date.now() - started })
    return res
  })

  ipcMain.handle(IPC.AGENT_FETCH, async (event, input: AgentFetchInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, error: 'untrusted IPC sender' }
    const frozen: AgentFetchInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      url: String(input.url ?? '').trim(),
      path: String(input.path ?? '').trim(),
      files: (input.files ?? []).map((file) => ({ path: String(file.path), content: String(file.content) }))
    })
    const authorization = await authorizeNativeCapability(
      { capability: 'fetch', projectName: frozen.projectName, detail: `${frozen.url} → ${frozen.path}` },
      frozen.authorization,
      confirmNativeCapability
    )
    if (!authorization.allowed) return { ok: false, error: authorization.reason }
    await syncWorkspace(frozen.projectName, frozen.files)
    return fetchToFile(frozen.projectName, frozen.url, frozen.path)
  })

  ipcMain.handle(IPC.AGENT_FONT, async (event, input: AgentFontInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, error: 'untrusted IPC sender' }
    const frozen: AgentFontInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      family: String(input.family ?? '').trim(),
      baseDir: input.baseDir === 'css' ? 'css' : 'src/assets',
      files: (input.files ?? []).map((file) => ({ path: String(file.path), content: String(file.content) }))
    })
    const authorization = await authorizeNativeCapability(
      { capability: 'font', projectName: frozen.projectName, detail: `${frozen.family} → ${frozen.baseDir}` },
      frozen.authorization,
      confirmNativeCapability
    )
    if (!authorization.allowed) return { ok: false, error: authorization.reason }
    await syncWorkspace(frozen.projectName, frozen.files)
    return addGoogleFont(frozen.projectName, frozen.family, frozen.baseDir)
  })

  // Calisma zamani hata toplayicisi (roadmap 3.2): sayfadaki kanca buraya
  // POST eder; olay renderer'a gecirilir ve otomatik duzeltme baslar.
  setRuntimeErrorCallback((e) => {
    mainWindow?.webContents.send(IPC.AGENT_RUNTIME_ERROR, e)
  })
  startRuntimeCollector()
  // Renderer, Çalıştır sonrası toplayıcının ayakta olup olmadığını sorar;
  // null port = otomatik hata yakalama yok, kullanıcıya dürüstçe söylenir.
  ipcMain.handle(IPC.RUNTIME_STATUS, () => ({ port: runtimeCollectorPort() }))

  // Yerel mini-benchmark (roadmap 4.5): yüklü modeli sabit görevle ölç.
  ipcMain.handle(IPC.BENCH_RUN, () => runBenchmark())
  ipcMain.handle(IPC.BENCH_GET, () => readBenchmarks())
  // Faz 3 — semantik indeks kalıcılığı (proje bazında, userData): açılışta yükle, tazeleyince yaz.
  ipcMain.handle(IPC.SEMANTIC_INDEX_LOAD, (_e, key: string) => loadSemanticIndex(key))
  ipcMain.handle(IPC.SEMANTIC_INDEX_SAVE, (_e, key: string, blob: string) => saveSemanticIndex(key, blob))

  // Gerçek runtime debugger (roadmap 6.1): çökme anını CDP ile oku.
  ipcMain.handle(IPC.DEBUG_INSPECT, (_e, input: { url: string }) => {
    if (!isLoopbackHttpUrl(input.url)) return { ok: false, error: 'Only loopback HTTP(S) URLs are allowed.' }
    return inspectRuntimeException(input.url)
  })

  // Davranışsal doğrulama (roadmap 6.5): siteyi tester gibi gez.
  ipcMain.handle(IPC.BEHAVIOR_TEST, (_e, input: { url: string }) => {
    if (!isLoopbackHttpUrl(input.url)) return { ok: false, error: 'Only loopback HTTP(S) URLs are allowed.' }
    return runBehaviorTest(input.url)
  })

  // Önce-repro onarım (roadmap 6.6): hata hâlâ üretiliyor mu?
  ipcMain.handle(IPC.REPRO_CHECK, (_e, input: { url: string; signature: string }) => {
    if (!isLoopbackHttpUrl(input.url)) return { ok: false, error: 'Only loopback HTTP(S) URLs are allowed.' }
    return reproCheck(input.url, input.signature)
  })

  // Öğrenen motor (roadmap 6.7): telemetri → sınıf istatistikleri.
  ipcMain.handle(IPC.REPAIR_STATS, () => readRepairStats())

  ipcMain.handle(IPC.AGENT_DEV_START, async (event, input: AgentDevInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, error: 'untrusted IPC sender' }
    const frozen: AgentDevInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      files: (input.files ?? []).map((file) => ({ path: String(file.path), content: String(file.content) }))
    })
    const authorization = await authorizeNativeCapability(
      { capability: 'dev', projectName: frozen.projectName, detail: 'Install dependencies when needed and start the development server.' },
      frozen.authorization,
      confirmNativeCapability
    )
    if (!authorization.allowed) return { ok: false, error: authorization.reason }
    const devExecId = frozen.execId
    const res = await startDev(frozen.projectName, frozen.files, (msg) => {
      mainWindow?.webContents.send(IPC.AGENT_DEV_STATUS, { msg })
      // 7.6: dev sunucusu durum satırları Terminal kartına da akar.
      if (devExecId) mainWindow?.webContents.send(IPC.TERM_OUTPUT, { execId: devExecId, chunk: msg + '\n' })
    })
    if (devExecId) {
      mainWindow?.webContents.send(IPC.TERM_OUTPUT, {
        execId: devExecId,
        done: true,
        ok: res.ok,
        exitCode: res.ok ? 0 : null
      })
    }
    if (res.ok) {
      // Dev sunucusu ayakta ama kod derlenmiyor olabilir (vite tembel derler):
      // arka planda tam derleme denetimi koş, hata varsa chat'e taşınmak üzere
      // renderer'a ilet. Kullanıcı "düzelt" yazınca hata modele otomatik gider.
      void buildCheck(frozen.projectName).then((check) => {
        if (!check.ok && check.error) {
          mainWindow?.webContents.send(IPC.AGENT_BUILD_ERROR, { error: check.error })
        }
      })
    } else if (res.error) {
      mainWindow?.webContents.send(IPC.AGENT_BUILD_ERROR, { error: res.error })
    }
    return res
  })

  ipcMain.handle(IPC.AGENT_BUILD_CHECK, async (event, input: AgentDevInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, error: 'untrusted IPC sender' }
    const frozen: AgentDevInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      files: (input.files ?? []).map((file) => ({ path: String(file.path), content: String(file.content) }))
    })
    // BUILD-CHECK is the app's OWN internal verification loop (postVerify /
    // repair), not a user- or agent-directed privileged effect. It ran silently
    // pre-v0.25; routing it through the native confirmation modal made the
    // auto-verify loop pop up to 4 dialogs per turn for a check the user never
    // requested (and pop even on fresh projects that then just skip). Restore the
    // silent behaviour — `buildCheck(onlyIfInstalled)` already no-ops on projects
    // without node_modules. Read-only tier still performs ZERO execution.
    if (frozen.authorization?.tier === 'read') return { ok: true, skipped: true }
    await syncWorkspace(frozen.projectName, frozen.files)
    return buildCheck(frozen.projectName, frozen.onlyIfInstalled)
  })

  ipcMain.handle(IPC.AGENT_DEV_STOP, async () => {
    await stopDev()
    return { ok: true }
  })

  // Bir [RUN] komutu diskte dosya değiştirdikten sonra editör/assets'i eşitle.
  ipcMain.handle(IPC.AGENT_RESCAN, async (_e, projectName: string) => {
    try {
      const { files, truncated } = await rescanWorkspace(projectName)
      return { ok: true, files, truncated }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Arayüz ölçeği (erişilebilirlik): tüm pencereyi büyüt/küçült. setZoomFactor
  // gerçek tarayıcı zoom'u gibi düzeni yeniden akıtır (CSS zoom'un h-screen
  // taşması olmaz). 0.6–3.0 arası kısılır.
  ipcMain.handle(IPC.UI_SET_ZOOM, (_e, factor: number) => {
    const f = Math.max(0.6, Math.min(3, Number(factor) || 1))
    mainWindow?.webContents.setZoomFactor(f)
    return { ok: true, factor: f }
  })

  ipcMain.handle(IPC.VISION_PICK_IMAGE, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Referans görsel seç',
      properties: ['openFile'],
      filters: [{ name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    approvedExternalPaths.add(resolve(res.filePaths[0]))
    return { path: res.filePaths[0] }
  })

  ipcMain.handle(IPC.VISION_ANALYZE, async (event, input: { imagePath: string; prompt: string; modelPath?: string }) => {
    const frozen = Object.freeze({
      imagePath: resolve(String(input.imagePath ?? '')),
      prompt: String(input.prompt ?? ''),
      modelPath: input.modelPath ? resolve(String(input.modelPath)) : undefined
    })
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      {
        capability: hasApiOverride() ? 'network' : 'external-read',
        projectName: '',
        detail: hasApiOverride()
          ? `Send this image to the active API for analysis:\n${frozen.imagePath}`
          : `Analyze this image with local native inference:\n${frozen.imagePath}${frozen.modelPath ? `\nModel: ${frozen.modelPath}` : ''}`
      },
      hasApiOverride()
        ? 'The image and analysis prompt will leave the device.'
        : 'This reads an image and may execute a native vision model.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    // İKİ AŞAMALI GÖRSEL AKIŞI — 1. AŞAMA (analiz).
    // API modeli aktifse görsel analizini API'nin KENDİSİ yapar (yerel VL ASLA
    // çalışmaz). Görsel + detaylı analiz prompt'u API'ye multimodal gider,
    // ölçülebilir tasarım spec'i döner; bu spec 2. aşamada (frontier build)
    // tam projeyi kurmak için kullanılır. "Localde hiçbir şey API'yi etkilemez."
    if (hasApiOverride()) {
      try {
        mainWindow?.webContents.send(IPC.VISION_STATUS, { msg: 'API görseli inceliyor…' })
        const dataUrl = await imageToDataUrl(frozen.imagePath)
        const sys =
          'You are a meticulous senior UI/UX design analyst. You are shown ONE screenshot of a website/app design. Produce a precise, MEASURABLE reconstruction spec that another developer will build from — never write code, only the spec. Report exact hex colors per region, typography, every section top-to-bottom with its layout and real text content, components and their styles. Read colors and text ONLY from the image; never invent template colors. Be exhaustive: if the page has 6 sections, describe all 6.'
        let text = ''
        const out = await promptApi(sys, frozen.prompt, (t) => {
          text += t
        }, undefined, { imageDataUrl: dataUrl, temperature: 0.2, maxTokens: 4096 })
        const full = (out && out.trim()) || text.trim()
        if (!full) return { ok: false, error: 'API görsel analizinden boş yanıt döndü' }
        return { ok: true, text: full }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
    return analyzeImage(
      frozen.imagePath,
      frozen.prompt,
      (msg) => {
        mainWindow?.webContents.send(IPC.VISION_STATUS, { msg })
      },
      frozen.modelPath
    )
  })

  // Yereldeki görsel (VL) GGUF çiftlerini listele (Ayarlar'daki seçici için).
  ipcMain.handle(IPC.VISION_LIST_MODELS, async () => {
    try {
      return scanInstalledVisionModels()
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.VISION_PREPARE, async (event) => {
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'network', projectName: '', detail: 'Prepare the local vision runtime and download missing components when required.' },
      'Preparation may download executable or model assets and start a native sidecar.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    return ensureVisionReady((msg) => {
      mainWindow?.webContents.send(IPC.VISION_STATUS, { msg })
    })
  })

  // Görsel ÜRETME — aktif API modeli görsel-üretme modeliyse (qwen-image, dall-e,
  // flux…). Sonuç kendine-yeterli data-URL (base64) döner: sohbette inline
  // önizleme + tam ekran + indirme + assets'e ekleme hepsi bundan çalışır.
  ipcMain.handle(
    IPC.IMAGE_GENERATE,
    async (
      event,
      input: {
        prompt: string
        aspect?: import('../shared/imageModels').ImageAspect
        count?: number
        negativePrompt?: string
        promptExtend?: boolean
        referenceImagePath?: string
        preferLocal?: boolean
        localModelPath?: string
      }
    ) => {
      try {
        const allowed = await confirmDirectPrivilegedEffect(
          event,
          {
            capability: 'network',
            projectName: '',
            detail: `Generate ${Math.max(1, Math.min(4, Number(input.count) || 1))} image(s):\n${String(input.prompt ?? '').slice(0, 1200)}${input.referenceImagePath ? `\nReference: ${resolve(input.referenceImagePath)}` : ''}${input.localModelPath ? `\nLocal model: ${resolve(input.localModelPath)}` : ''}`
          },
          'Image generation may contact the active API or execute a local native model.'
        )
        if (!allowed) return { ok: false, error: 'Native approval denied.' }
        // Görsel→görsel: referans dosyayı data-URL'e çevir (görsel modele gider).
        let referenceImageDataUrl: string | undefined
        if (input.referenceImagePath) {
          try {
            referenceImageDataUrl = await imageToDataUrl(input.referenceImagePath)
          } catch {
            /* referans okunamazsa referanssız üret */
          }
        }
        const results = await generateImage(input.prompt, {
          onStatus: (msg) => mainWindow?.webContents.send(IPC.IMAGE_STATUS, { msg }),
          aspect: input.aspect,
          n: input.count,
          negativePrompt: input.negativePrompt,
          promptExtend: input.promptExtend,
          referenceImageDataUrl,
          preferLocal: input.preferLocal,
          localModelPath: input.localModelPath
        })
        const slug =
          input.prompt.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gorsel'
        const dir = join(homedir(), 'NexoraAI', 'cache', 'generated')
        try {
          await mkdir(dir, { recursive: true })
        } catch {
          /* cache opsiyonel */
        }
        const images: Array<{ dataUrl: string; name: string }> = []
        for (let i = 0; i < results.length; i++) {
          const { b64, mime } = results[i]
          const ext = /jpe?g/i.test(mime) ? 'jpg' : /webp/i.test(mime) ? 'webp' : 'png'
          const name = `${slug}${results.length > 1 ? `-${i + 1}` : ''}-${Date.now()}.${ext}`
          try {
            await writeFile(join(dir, name), Buffer.from(b64, 'base64'))
          } catch {
            /* cache opsiyonel — data-URL yeterli */
          }
          images.push({ dataUrl: `data:${mime};base64,${b64}`, name })
        }
        // Faz 13 — alışverişi YEREL motorun geçmişine de işle: görselden sonra
        // yerel text modeli "az önce ne yapıldı" sorusuna cevap verebilsin
        // (API bunu apiHistory izinden zaten görüyor; yerel motor görmüyordu).
        if (images.length > 0) {
          const { noteImageExchange } = await import('./llamaService')
          noteImageExchange(
            input.prompt,
            `[Sistem notu: Yerel görsel motoru bu istekten ${images.length > 1 ? images.length + ' adet PNG' : 'bir PNG'} üretti ve sohbette gösterdi: "${input.prompt}". Görsel HAZIR ve tamamlandı — yeniden üretme, SVG/kod yazma. Sorulursa yalnızca ne üretildiğini söyle.]`
          )
        }
        return { ok: true, images }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  // Üretilen görseli kullanıcının seçtiği yere kaydet (indirme).
  ipcMain.handle(IPC.IMAGE_SAVE_AS, async (_e, input: { dataUrl: string; name: string }) => {
    try {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(input.dataUrl)
      if (!m) return { ok: false, error: 'Geçersiz görsel verisi.' }
      const res = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Masaüstü', input.name || 'gorsel.png'),
        filters: [{ name: 'Görsel', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, error: 'iptal' }
      await writeFile(res.filePath, Buffer.from(m[2], 'base64'))
      return { ok: true, savedPath: res.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Faz 13 — yerel görsel-üretim modeli kataloğu + durumu (indirici için).
  ipcMain.handle(IPC.IMAGE_MODELS_LIST, async () => {
    const li = await import('./localImageService')
    let vramGb = 0
    try {
      const hw = await detectHardware()
      vramGb = hw?.gpu?.vramGb ?? 0
    } catch {
      /* VRAM okunamazsa 0 (rozet 🔵 gösterir) */
    }
    return { catalog: li.imageCatalogStatus(), installed: li.scanInstalledImageModels(), vramGb }
  })

  // Katalogdan bir görsel modelini tek-tık indir (ilerleme IMAGE_DL_STATUS ile).
  ipcMain.handle(IPC.IMAGE_MODEL_DOWNLOAD, async (event, id: string) => {
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'network', projectName: '', detail: `Download image model from the built-in catalog:\n${String(id ?? '')}` },
      'This downloads remote model content and writes it to managed storage.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    const li = await import('./localImageService')
    return li.downloadCatalogModel(id, (msg) => mainWindow?.webContents.send(IPC.IMAGE_DL_STATUS, { msg }))
  })

  // HuggingFace'te ÖZGÜRCE görsel-üretim modeli ara (GGUF bulur gibi).
  ipcMain.handle(IPC.IMAGE_MODEL_SEARCH, async (event, query: string) => {
    try {
      const frozenQuery = String(query ?? '').trim().slice(0, 300)
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'network', projectName: '', detail: `Search remote image models for:\n${frozenQuery}` },
        'This sends the search query to a remote model catalogue.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      const li = await import('./localImageService')
      return { ok: true, results: await li.searchImageModels(frozenQuery) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Arama sonucundan (URL) bir görsel modelini indir.
  ipcMain.handle(IPC.IMAGE_MODEL_DOWNLOAD_URL, async (event, input: { url: string; file: string }) => {
    const frozen = Object.freeze({ url: String(input.url ?? '').trim(), file: String(input.file ?? '').trim() })
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'network', projectName: '', detail: `Download image model:\n${frozen.url}\nFile: ${frozen.file}` },
      'This downloads content from a renderer-supplied URL and writes it to managed storage.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    const li = await import('./localImageService')
    return li.downloadImageUrl(frozen.url, frozen.file, (msg) => mainWindow?.webContents.send(IPC.IMAGE_DL_STATUS, { msg }))
  })

  // 20.3 — Yerel Whisper dikte: durum (binary+model hazır mı) + katalog.
  ipcMain.handle(IPC.WHISPER_STATUS, async () => {
    try {
      const ws = await import('./whisperService')
      return { ok: true, ...(await ws.whisperStatus()) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Renderer'ın yakaladığı WAV'ı offline yazıya çevir (ses cihazda kalır).
  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (event, input: { wav: ArrayBuffer; lang?: string; modelPath?: string }) => {
    try {
      const modelPath = input.modelPath ? resolve(String(input.modelPath)) : undefined
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'external-read', projectName: '', detail: `Transcribe captured audio with the local Whisper process.${modelPath ? `\nModel: ${modelPath}` : '\nA managed model may be downloaded if none is installed.'}` },
        'Transcription starts a fixed native process and may download the built-in model when missing.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      const ws = await import('./whisperService')
      return await ws.transcribe(input.wav, { lang: input.lang, modelPath }, (msg) =>
        mainWindow?.webContents.send(IPC.WHISPER_PROGRESS, { msg })
      )
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Katalogdan whisper ggml modelini tek-tık indir (ilerleme WHISPER_PROGRESS ile).
  ipcMain.handle(IPC.WHISPER_MODEL_DOWNLOAD, async (event, id: string) => {
    try {
      const frozenId = String(id ?? '')
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'network', projectName: '', detail: `Download Whisper model:\n${frozenId}` },
        'This downloads remote model content and writes it to managed storage.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      const ws = await import('./whisperService')
      return await ws.downloadWhisperModel(frozenId, (msg) => mainWindow?.webContents.send(IPC.WHISPER_PROGRESS, { msg }))
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.ADVISOR_DETECT, async () => {
    return detectHardware()
  })

  ipcMain.handle(IPC.ADVISOR_PLAN, async () => {
    // Startup/UI reads are offline: remote catalogue refresh must become a
    // separate explicit user action before it may opt into network access.
    return getAdvisorPlan(false)
  })

  ipcMain.handle(IPC.SESSIONS_LIST, async () => {
    return listSessions()
  })

  ipcMain.handle(IPC.SESSIONS_SAVE, async (_e, data: SessionData) => {
    await saveSession(data)
    return { ok: true }
  })

  ipcMain.handle(IPC.SESSIONS_LOAD, async (_e, id: string) => {
    return loadSession(id)
  })

  ipcMain.handle(IPC.SESSIONS_DELETE, async (_e, id: string) => {
    await deleteSession(id)
    return { ok: true }
  })

  // 16.3: oturumu markdown olarak dışa aktar — YEREL kaydet-farklı-kaydet (dosya
  // kullanıcının seçtiği yere iner, hiçbir yere yüklenmez). Renderer markdown'ı
  // composeSessionMarkdown ile üretir; main yalnız güvenli diyalog + yazımı yapar.
  ipcMain.handle(IPC.SESSIONS_EXPORT, async (_e, input: { name: string; markdown: string }) => {
    try {
      const res = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Masaüstü', (input.name || 'nexora-oturum') + '.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, error: 'iptal' }
      await writeFile(res.filePath, input.markdown, 'utf8')
      return { ok: true, savedPath: res.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Proje bilgi tabanı (7.8): deterministik öğrenme + karşı-kanıt emekliliği.
  ipcMain.handle(IPC.KNOWLEDGE_LEARN, async (_e, input: { projectName: string; kind: string; title: string; body: string; sig?: string }) => {
    return learnKnowledge(input.projectName, input as Parameters<typeof learnKnowledge>[1])
  })
  ipcMain.handle(IPC.KNOWLEDGE_LIST, async (_e, projectName: string) => listKnowledge(projectName))
  ipcMain.handle(IPC.KNOWLEDGE_READ, async (_e, input: { projectName: string; file: string }) => {
    return readKnowledge(input.projectName, input.file)
  })
  ipcMain.handle(IPC.KNOWLEDGE_DELETE, async (_e, input: { projectName: string; file: string }) => {
    return deleteKnowledge(input.projectName, input.file)
  })
  ipcMain.handle(IPC.KNOWLEDGE_RETIRE, async (_e, input: { projectName: string; sig: string }) => {
    return retireKnowledgeBySig(input.projectName, input.sig)
  })
  ipcMain.handle(IPC.KNOWLEDGE_CONTEXT, async (_e, projectName: string, query?: string) => knowledgeContext(projectName, 1200, query ?? ''))

  // Hiyerarşik kurallar (7.8): global ~/NexoraAI/KURALLAR.md + proje birleşimi.
  ipcMain.handle(IPC.RULES_GET_GLOBAL, async () => ({ content: await getGlobalRules() }))
  ipcMain.handle(IPC.RULES_SET_GLOBAL, async (_e, content: string) => {
    await setGlobalRules(content)
    return { ok: true }
  })
  ipcMain.handle(IPC.RULES_GET_MERGED, async (_e, projectName: string) => getMergedRules(projectName))

  // Artifact belgeleri (7.2): plan / görev listesi / walkthrough — sürümlemeli.
  ipcMain.handle(IPC.ARTIFACT_DOC_SAVE, async (_e, input: { sessionId: string; name: string; content: string }) => {
    return saveArtifactDoc(input.sessionId, input.name, input.content)
  })
  ipcMain.handle(IPC.ARTIFACT_DOC_LIST, async (_e, sessionId: string) => {
    return listArtifactDocs(sessionId)
  })
  ipcMain.handle(IPC.ARTIFACT_DOC_READ, async (_e, input: { sessionId: string; name: string; version?: number }) => {
    return readArtifactDoc(input.sessionId, input.name, input.version)
  })

  // Klasör Aç (roadmap 3.1): var olan projeyi çalışma alanına bağla.
  ipcMain.handle(IPC.PROJECT_IMPORT, async () => {
    try {
      const result = await importProjectFolder()
      if (result && typeof result === 'object' && 'folderPath' in result && typeof result.folderPath === 'string') {
        approvedExternalDirectories.add(resolve(result.folderPath))
      }
      return result
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Görsel öz-denetim (roadmap 3.3): dev sayfasının ekran görüntüsü.
  ipcMain.handle(IPC.AGENT_CAPTURE_PAGE, async (_e, input: { url: string }) => {
    try {
      if (!isLoopbackHttpUrl(input.url)) return { ok: false, error: 'Only loopback HTTP(S) URLs are allowed.' }
      return await capturePage(input.url)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.REPAIR_LOG, async (_e, entry: Record<string, unknown>) => {
    await appendRepairLog(entry)
    return { ok: true }
  })

  // 4.3: çoklu proje çalışma alanı
  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    try {
      return await listProjects()
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.PROJECT_OPEN, async (_e, dir: string) => {
    try {
      const target = resolve(String(dir ?? ''))
      const registered = await listProjects()
      const known = registered.some((project) => resolve(project.dir) === target)
      if (!known && !approvedExternalDirectories.has(target)) {
        return { ok: false, error: 'Project path is not registered or selected through the native folder picker.' }
      }
      return await openProjectDir(target)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Git tabanlı üretim geçmişi (roadmap 3.4).
  ipcMain.handle(
    IPC.HISTORY_COMMIT,
    async (_e, input: { projectName: string; files: Array<{ path: string; content: string }>; message: string }) => {
      try {
        return await historyCommit(input.projectName, input.files, input.message, (input as { green?: boolean }).green)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IPC.HISTORY_LIST, async (_e, projectName: string) => {
    try {
      return await historyList(projectName)
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.HISTORY_RESTORE, async (event, projectName: string, hash: string) => {
    try {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'history', projectName: String(projectName ?? ''), detail: `Restore Git checkpoint:\n${String(hash ?? '')}` },
        'Restoring replaces the current managed workspace with historical content.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      return await historyRestore(projectName, hash)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.HISTORY_RESTORE_GREEN, async (event, projectName: string) => {
    try {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'history', projectName: String(projectName ?? ''), detail: 'Restore the latest checkpoint marked green.' },
        'Restoring replaces the current managed workspace with historical content.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
      return await historyRestoreGreen(projectName)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  // 7.3 inceleme paneli: ref'teki dosyalar (salt-okur).
  ipcMain.handle(IPC.HISTORY_FILES_AT, async (_e, projectName: string, ref: string) => {
    try {
      return await historyFilesAt(projectName, ref)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.RULES_GET, async (_e, projectName: string) => {
    return { content: await getRules(projectName) }
  })

  ipcMain.handle(IPC.RULES_SET, async (_e, projectName: string, content: string) => {
    await setRules(projectName, content)
    return { ok: true }
  })

  ipcMain.handle(IPC.AGENT_DEV_STATUS, async () => {
    return { url: getDevUrl() }
  })

  // ── 10.1 MCP: yerel stdio araç sunucuları ──────────────────────────────────
  ipcMain.handle(IPC.MCP_SERVERS, async (event) => {
    const configured = await mcpReadConfig()
    if (configured.some((server) => server.enabled !== false)) {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'mcp-lifecycle', projectName: '', detail: configured.filter((server) => server.enabled !== false).map((server) => `${server.name}: ${server.command} ${(server.args ?? []).join(' ')}`).join('\n') },
        'Listing MCP servers starts enabled local commands so their tools can be discovered.'
      )
      if (!allowed) return { servers: await mcpGetServers(), canceled: true }
      mcpSetLifecycleAuthorized(true)
    }
    return { servers: await mcpGetServers() }
  })
  ipcMain.handle(IPC.MCP_CALL, async (event, input: McpCallInput) => {
    if (!isTrustedIpcSender(event)) return { ok: false, content: 'untrusted IPC sender' }
    const frozen: McpCallInput = Object.freeze({
      ...input,
      projectName: String(input.projectName ?? ''),
      server: String(input.server ?? '').trim(),
      tool: String(input.tool ?? '').trim(),
      args: input.args && typeof input.args === 'object' ? structuredClone(input.args) : {}
    })
    const authorization = await authorizeNativeCapability(
      {
        capability: 'mcp',
        projectName: frozen.projectName,
        detail: `${frozen.server}.${frozen.tool} ${JSON.stringify(frozen.args ?? {})}`
      },
      frozen.authorization,
      confirmNativeCapability
    )
    if (!authorization.allowed) return { ok: false, content: authorization.reason }
    mcpSetLifecycleAuthorized(true)
    return mcpCallTool(frozen.server, frozen.tool, frozen.args || {})
  })
  ipcMain.handle(IPC.MCP_RELOAD, async (event) => {
    const configured = await mcpReadConfig()
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'mcp-lifecycle', projectName: '', detail: configured.filter((server) => server.enabled !== false).map((server) => `${server.name}: ${server.command} ${(server.args ?? []).join(' ')}`).join('\n') || '(no enabled servers)' },
      'Reloading MCP can stop and start configured local processes.'
    )
    if (!allowed) return { servers: await mcpGetServers(), canceled: true }
    mcpSetLifecycleAuthorized(true)
    return { servers: await mcpReload() }
  })
  ipcMain.handle(IPC.MCP_GET_CONFIG, async () => {
    const servers = (await mcpReadConfig()).map(({ env: _env, ...server }) => server)
    return { servers, path: mcpConfigPath(), envRedacted: true }
  })
  ipcMain.handle(IPC.MCP_SET_CONFIG, async (event, servers: McpServerConfigInput[]) => {
    if (!isTrustedIpcSender(event)) return { servers: await mcpGetServers(), error: 'untrusted IPC sender' }
    const existing = await mcpReadConfig()
    const merged = servers.map((server) => {
      if (server.env && Object.keys(server.env).length > 0) return server
      const prior = existing.find((entry) => entry.name === server.name)
      return prior?.env ? { ...server, env: prior.env } : server
    })
    const allowed = await confirmNativeCapability(
      {
        capability: 'mcp-lifecycle',
        projectName: '',
        detail: merged.map((server) => {
        const env = Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join(' ')
        return `${server.enabled === false ? '○' : '●'} ${server.name}: ${env ? `${env} ` : ''}${server.command} ${(server.args ?? []).join(' ')}`
        }).join('\n').slice(0, 3000)
      },
      'Saving this configuration can start local processes with your user permissions.'
    )
    if (!allowed) return { servers: await mcpGetServers(), canceled: true }
    await mcpWriteConfig(merged)
    mcpSetLifecycleAuthorized(true)
    return { servers: await mcpReload() }
  })

  // ── 10.2 Serve engine: yerel OpenAI-uyumlu uç ────────────────────────────
  ipcMain.handle(IPC.SERVE_SET, async (event, input: { enabled: boolean; port?: number }) => {
    if (!input.enabled) {
      stopServe()
      return serveStatus()
    }
    const port = Math.max(1024, Math.min(65535, Number(input.port) || 8787))
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'serve', projectName: '', detail: `Expose the loaded model on localhost TCP port ${port}.` },
      'Starting the local API binds a network listener accessible to local applications.'
    )
    if (!allowed) return { running: false, port: 0, url: '', error: 'Native approval denied.' }
    try {
      return await startServe(port, {
        generate: generateForServe,
        isLoaded: isModelLoaded,
        modelName: () => getLoadedInfo()?.name || 'nexora-local'
      })
    } catch (e) {
      return { running: false, port: 0, url: '', error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.SERVE_STATUS, () => serveStatus())

  // ── 10.5 OS tümleşiği: bildirim + uyku engelleyici ───────────────────────
  ipcMain.handle(IPC.SYSTEM_NOTIFY, (_e, input: { title: string; body: string }) => {
    // Pencere odaktaysa bildirim gösterme (renderer da kontrol eder — çift kemer).
    if (mainWindow?.isFocused()) return { shown: false }
    showNotification(input.title, input.body)
    return { shown: true }
  })
  ipcMain.handle(IPC.SYSTEM_KEEP_AWAKE, (_e, on: boolean) => {
    setKeepAwake(on)
    return { ok: true }
  })

  // ── 10.6 Genel arama: oturum/proje/bilgi/kod ─────────────────────────────
  ipcMain.handle(IPC.SEARCH_GLOBAL, (_e, input: { query: string; activeProject?: string }) =>
    globalSearch(input.query, input.activeProject)
  )

  // ── 10.8 Slash-komut iş akışları (.md → /komut) ──────────────────────────
  ipcMain.handle(IPC.COMMANDS_LIST, () => listCommands())

  // ── 10.9 Sağlayıcı hub'ı: keychain anahtarlar + aktivasyon + model çekme ──
  ipcMain.handle(IPC.PROVIDERS_SET_KEY, async (event, input: { providerId: string; key: string }) => {
    const providerId = String(input.providerId ?? '').trim()
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'credential', projectName: '', detail: `Store an API credential for provider: ${providerId}\nCredential value: (hidden)` },
      'The credential is persisted through the operating-system storage boundary.'
    )
    if (!allowed) return { ok: false, encrypted: false, error: 'Native approval denied.' }
    return setProviderKey(providerId, String(input.key ?? ''))
  })
  ipcMain.handle(IPC.PROVIDERS_DELETE_KEY, async (event, providerId: string) => {
    const frozenId = String(providerId ?? '').trim()
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'credential', projectName: '', detail: `Delete the stored API credential for provider: ${frozenId}` },
      'Deleting a credential changes persistent secure storage.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    return deleteProviderKey(frozenId)
  })
  ipcMain.handle(IPC.PROVIDERS_LIST_CONFIGURED, () => listConfiguredProviders())
  ipcMain.handle(IPC.PROVIDERS_ACTIVATE, async (event, input: { providerId: string; model: string; mode: 'off' | 'fix' | 'all'; customBaseUrl?: string }) => {
    const frozen = Object.freeze({ providerId: String(input.providerId ?? ''), model: String(input.model ?? ''), mode: input.mode, customBaseUrl: input.customBaseUrl ? String(input.customBaseUrl) : undefined })
    if (frozen.mode !== 'off') {
      const allowed = await confirmDirectPrivilegedEffect(
        event,
        { capability: 'network', projectName: '', detail: `Activate remote provider: ${frozen.providerId}\nModel: ${frozen.model}\nMode: ${frozen.mode}${frozen.customBaseUrl ? `\nURL: ${frozen.customBaseUrl}` : ''}` },
        'The selected route can send prompts, project code, and optional images off-device.'
      )
      if (!allowed) return { ok: false, error: 'Native approval denied.' }
    }
    return activateProvider(frozen)
  })
  ipcMain.handle(IPC.PROVIDERS_FETCH_MODELS, async (event, input: { providerId: string; customBaseUrl?: string }) => {
    const frozen = Object.freeze({ providerId: String(input.providerId ?? ''), customBaseUrl: input.customBaseUrl ? String(input.customBaseUrl) : undefined })
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'network', projectName: '', detail: `Fetch remote model list for provider: ${frozen.providerId}${frozen.customBaseUrl ? `\nURL: ${frozen.customBaseUrl}` : ''}` },
      'This contacts the provider models endpoint using the configured credential.'
    )
    if (!allowed) return { ok: false, models: [], error: 'Native approval denied.' }
    return fetchProviderModels(frozen.providerId, frozen.customBaseUrl)
  })
  ipcMain.handle(IPC.PROVIDERS_SET_ACTIVE_MODEL, async (event, input: { providerId: string; model: string; customBaseUrl?: string }) => {
    const frozen = Object.freeze({ providerId: String(input.providerId ?? ''), model: String(input.model ?? ''), customBaseUrl: input.customBaseUrl ? String(input.customBaseUrl) : undefined })
    const allowed = await confirmDirectPrivilegedEffect(
      event,
      { capability: 'network', projectName: '', detail: `Route all model requests to provider: ${frozen.providerId}\nModel: ${frozen.model}${frozen.customBaseUrl ? `\nURL: ${frozen.customBaseUrl}` : ''}` },
      'The active model route can send prompts, project code, and optional images off-device.'
    )
    if (!allowed) return { ok: false, error: 'Native approval denied.' }
    return setActiveModel(frozen)
  })
  ipcMain.handle(IPC.PROVIDERS_CLEAR_ACTIVE_MODEL, () => clearActiveModel())

  // ── 10.12.1 Kalıcı proje bağlamı: proje-gecmisi.md ───────────────────────
  ipcMain.handle(IPC.PROJHIST_RECORD, (_e, i: { projectName: string; text: string; model?: string }) =>
    histRecord(i.projectName, i.text, i.model).then(() => ({ ok: true }))
  )
  ipcMain.handle(IPC.PROJHIST_DECISION, (_e, i: { projectName: string; text: string }) =>
    histDecision(i.projectName, i.text).then(() => ({ ok: true }))
  )
  ipcMain.handle(IPC.PROJHIST_SEED, (_e, i: { projectName: string; purpose?: string; techStack?: string[]; architecture?: string[] }) =>
    histSeed(i.projectName, i).then(() => ({ ok: true }))
  )
  ipcMain.handle(IPC.PROJHIST_SWITCH, (_e, i: { projectName: string; toModel: string }) =>
    histSwitch(i.projectName, i.toModel).then(() => ({ ok: true }))
  )
  ipcMain.handle(IPC.PROJHIST_GET, (_e, projectName: string) => getHistoryRaw(projectName))
  ipcMain.handle(IPC.PROJHIST_SET, (_e, i: { projectName: string; content: string }) => setHistoryRaw(i.projectName, i.content))
  ipcMain.handle(IPC.PROJHIST_CONTEXT, (_e, projectName: string) => historyContext(projectName))
}

void app.whenReady().then(async () => {
  registerIpc()
  createWindow()
  setupTray(() => mainWindow) // 10.5: sistem tepsisi

  if (process.env['NEXORA_SELFTEST']) {
    const path = process.env['NEXORA_SELFTEST']
    const gpu = process.env['NEXORA_SELFTEST_GPU'] === '1'
    try {
      console.log('[selftest] loading', path, 'gpu =', gpu)
      const info = await loadModel(path, gpu)
      console.log('[selftest] loaded', info.name, 'gpu=' + info.gpu, 'layers=' + info.gpuLayers + '/' + info.totalLayers, 'ctx=' + info.contextSize)
      console.log('[selftest] family=' + getActiveFamily() + ' familyNoteInPrompt=' + debugHasFamilyNote())
      const t1 = Date.now()
      const prompt1 = process.env['NEXORA_SELFTEST_PROMPT'] ?? 'My favorite fruit is mango. Reply with just: OK'
      const full = await chat({ prompt: prompt1, options: { maxTokens: process.env['NEXORA_SELFTEST_PROMPT'] ? 48 : 8, temperature: 0 } }, (t) => process.stdout.write(t))
      console.log(`\n[selftest] turn1 len=${full.length} (${Date.now() - t1}ms)`)
      // İkinci tur: sohbet geçmişi motorda yaşıyor mu? (cevap ilk turdan gelmeli)
      const t2 = Date.now()
      const full2 = await chat({ prompt: 'What is my favorite fruit? One word.', options: { maxTokens: 8, temperature: 0 } }, (t) => process.stdout.write(t))
      console.log(`\n[selftest] turn2 answer="${full2.trim()}" (${Date.now() - t2}ms)`)
      // Planlı dosya-dosya üretim hattı (roadmap 2.2): plan grameri →
      // liste ayrıştırma → her dosya kendi yoluna kilitli gramerle.
      if (process.env['NEXORA_SELFTEST_PLANBUILD'] === '1') {
        const tp = Date.now()
        const planOut = await chat(
          {
            prompt:
              '=== PLAN MODE ===\nDo NOT write any code. Write the FILE PLAN for the request below: a numbered list (2-12 lines), EACH line EXACTLY: N. <file path> — <one-line description>. Foundations first, entry file LAST.\nUser request: Bana modern bir kafe web sitesi yap (menü, hakkında, iletişim).',
            expectPlan: true,
            options: { maxTokens: 300, temperature: 0.7, topP: 0.95 }
          },
          () => {}
        )
        const planned = [...planOut.matchAll(/^\s*\d{1,2}[.)]\s*([\w@][\w@./-]*\.[a-z]{1,4})\s*(?:[—–:-]\s*)?(.*)$/gim)].map(
          (m) => ({ path: m[1], desc: (m[2] ?? '').trim() })
        )
        console.log(`[selftest] plan: ${planned.length} dosya (${Date.now() - tp}ms):`, planned.map((p) => p.path).join(', '))
        for (const f of planned.slice(0, 2)) {
          const tf = Date.now()
          const out = await chat(
            {
              prompt: `=== PLANNED BUILD ===\nProject brief: modern kafe sitesi.\nFile plan: ${planned.map((p) => p.path).join(', ')}\nWrite ONLY the COMPLETE content of: ${f.path}${f.desc ? ' — ' + f.desc : ''}\nOutput EXACTLY ONE fenced code block for ${f.path}.`,
              expectFile: f.path,
              options: { maxTokens: 3000, temperature: 0.2 }
            },
            () => {}
          )
          const fenceOk = new RegExp('^```[a-z]+ ' + f.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n[\\s\\S]+```\\s*$').test(out.trim())
          console.log(`[selftest] file ${f.path}: singleBlock=${fenceOk} len=${out.length} (${Date.now() - tf}ms)`)
        }
      }
      // UPDATE turu: gramerli cerrahi düzenleme hattı (roadmap 2.1)
      if (process.env['NEXORA_SELFTEST_UPDATE'] === '1') {
        const demo = `export default function App() {\n  return (\n    <div>\n      <h1>Fırın Luna</h1>\n      <p>Taze ekmek</p>\n    </div>\n  )\n}\n`
        const t3 = Date.now()
        const full3 = await chat(
          {
            prompt: 'Başlıktaki "Fırın Luna" yazısını "Luna Bakery" yap.',
            currentFiles: [{ path: 'src/App.tsx', content: demo }],
            options: { maxTokens: 200, temperature: 0.2 }
          },
          () => {}
        )
        const hasEdit = /```edit src\/App\.tsx\n<<<<<<< SEARCH\n/.test(full3)
        const searchSizes = [...full3.matchAll(/<<<<<<< SEARCH\n([\s\S]*?)=======\n/g)].map((m) => m[1].split('\n').length - 1)
        console.log(`[selftest] update-turn: editBlock=${hasEdit} searchLines=[${searchSizes.join(',')}] (${Date.now() - t3}ms)`)
        console.log('[selftest] update-output:\n' + full3.slice(0, 400))
      }
    } catch (err) {
      console.error('[selftest] FAILED', (err as Error).message)
    } finally {
      app.quit()
    }
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Faz 3 — sidecar teardown'larını merkezi registry'ye kaydet. Statik-bilinenler
// burada; lazy-spawn edilenler (sd-server, embed) kendi spawn noktalarında kaydeder.
// Not: hepsi null-güvenli no-op (koşmuyorsa zarar yok). registerSidecarStop +
// stopAllSidecars ./sidecarLifecycle'dan statik import edilir.
registerSidecarStop('text-worker', disposeWorker)
registerSidecarStop('dev-server', stopDev)
registerSidecarStop('vision', stopVisionServer)
registerSidecarStop('mcp', mcpShutdown)
registerSidecarStop('serve', stopServe)
app.on('before-quit', () => {
  // Tüm sidecar'lar İZOLE try/catch'te kapanır (biri fırlarsa gerisi yine kapanır →
  // orphan yok). Eskiden sd-server + embed HİÇ kapatılmıyordu (Faz 3 canlı bulgu).
  void stopAllSidecars()
  setKeepAwake(false)
  disposeTray()
})
