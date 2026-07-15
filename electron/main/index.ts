import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
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
import { inspectRuntimeException } from './debugInspect'
import { runBehaviorTest } from './behaviorTest'
import { reproCheck } from './reproCheck'
import { analyzeImage, stopVisionServer, ensureVisionReady, scanInstalledVisionModels } from './visionService'
import { detectHardware, getAdvisorPlan } from './advisorService'
import { setApiConfig, promptApi, hasApiOverride, generateImage, type ApiConfig } from './apiEngine'
import { writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
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
  shutdown as mcpShutdown
} from './mcpService'
import { startServe, stopServe, serveStatus } from './serveEngine'
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

let mainWindow: BrowserWindow | null = null

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
      sandbox: false
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
    void shell.openExternal(url)
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
    return { path: res.filePaths[0] }
  })

  ipcMain.handle(IPC.MODEL_LOAD, async (_e, path: string, enableGpu?: boolean, gpuLayers?: number | 'auto') => {
    try {
      let lastSent = 0
      const info = await loadModel(path, enableGpu, gpuLayers, (stage, progress) => {
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

  ipcMain.handle(IPC.MODEL_SET_API_CONFIG, async (_e, config: Partial<ApiConfig>) => {
    setApiConfig(config)
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
    await resetSession({ resetProfile: true })
    return { ok: true }
  })

  ipcMain.handle(IPC.CHAT_SEND, async (_e, input: ChatSendInput) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    try {
      const full = await chat(input, (token) => {
        mainWindow?.webContents.send(IPC.CHAT_STREAM, { token, done: false })
      })
      // 10.12.2: turun token kullanımını done olayıyla ilet (motor usage'ı / tahmin).
      mainWindow.webContents.send(IPC.CHAT_STREAM, { done: true, full, usage: getLastTurnUsage(), inspection: getLastTurnInspection() })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.CHAT_ABORT, async () => {
    await abortChat()
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

  ipcMain.handle(IPC.HF_SEARCH, async (_e, query: string) => {
    try {
      return { ok: true, results: await searchModels(query) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_LIST_LOCAL, async (_e, dir: string) => {
    try {
      return { ok: true, models: await listLocalModels(dir) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.HF_DELETE_LOCAL, async (_e, dir: string, name: string) => {
    return deleteLocalModel(dir, name)
  })

  ipcMain.handle(IPC.HF_SELECT_DIR, async () => {
    const res = await dialog.showOpenDialog({
      title: 'İndirme dizini seç',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false }
    return { ok: true, dir: res.filePaths[0] }
  })

  ipcMain.handle(IPC.HF_DOWNLOAD, async (_e, input: HfDownloadInput) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    try {
      const uri = `hf:${input.repo}/${input.file}`
      const modelPath = await downloadModel(uri, input.dir, (downloaded, total) => {
        mainWindow?.webContents.send(IPC.HF_PROGRESS, {
          file: input.file,
          downloaded,
          total,
          done: false
        })
      })
      mainWindow.webContents.send(IPC.HF_PROGRESS, { file: input.file, done: true, total: 0, downloaded: 0 })
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

  ipcMain.handle(IPC.AGENT_RUN, async (_e, input: AgentRunInput) => {
    await syncWorkspace(input.projectName, input.files)
    // 7.6 görünür terminal: execId verildiyse çıktı canlı olaylarla akar.
    const execId = input.execId
    const emit = (ev: Record<string, unknown>) => mainWindow?.webContents.send(IPC.TERM_OUTPUT, ev)
    const started = Date.now()
    const res = await runCommand(
      input.projectName,
      input.command,
      undefined,
      execId ? (chunk) => emit({ execId, chunk }) : undefined
    )
    if (execId) emit({ execId, done: true, ok: res.ok, exitCode: res.exitCode, durationMs: Date.now() - started })
    return res
  })

  ipcMain.handle(IPC.AGENT_FETCH, async (_e, input: AgentFetchInput) => {
    await syncWorkspace(input.projectName, input.files)
    return fetchToFile(input.projectName, input.url, input.path)
  })

  ipcMain.handle(IPC.AGENT_FONT, async (_e, input: AgentFontInput) => {
    await syncWorkspace(input.projectName, input.files)
    return addGoogleFont(input.projectName, input.family, input.baseDir)
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

  // Gerçek runtime debugger (roadmap 6.1): çökme anını CDP ile oku.
  ipcMain.handle(IPC.DEBUG_INSPECT, (_e, input: { url: string }) => inspectRuntimeException(input.url))

  // Davranışsal doğrulama (roadmap 6.5): siteyi tester gibi gez.
  ipcMain.handle(IPC.BEHAVIOR_TEST, (_e, input: { url: string }) => runBehaviorTest(input.url))

  // Önce-repro onarım (roadmap 6.6): hata hâlâ üretiliyor mu?
  ipcMain.handle(IPC.REPRO_CHECK, (_e, input: { url: string; signature: string }) =>
    reproCheck(input.url, input.signature)
  )

  // Öğrenen motor (roadmap 6.7): telemetri → sınıf istatistikleri.
  ipcMain.handle(IPC.REPAIR_STATS, () => readRepairStats())

  ipcMain.handle(IPC.AGENT_DEV_START, async (_e, input: AgentDevInput) => {
    const devExecId = (input as { execId?: string }).execId
    const res = await startDev(input.projectName, input.files, (msg) => {
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
      void buildCheck(input.projectName).then((check) => {
        if (!check.ok && check.error) {
          mainWindow?.webContents.send(IPC.AGENT_BUILD_ERROR, { error: check.error })
        }
      })
    } else if (res.error) {
      mainWindow?.webContents.send(IPC.AGENT_BUILD_ERROR, { error: res.error })
    }
    return res
  })

  ipcMain.handle(IPC.AGENT_BUILD_CHECK, async (_e, input: AgentDevInput) => {
    // "düzelt" turundan sonra doğrulama: güncel dosyaları senkronla ve derle
    await syncWorkspace(input.projectName, input.files)
    return buildCheck(input.projectName, input.onlyIfInstalled)
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
    return { path: res.filePaths[0] }
  })

  ipcMain.handle(IPC.VISION_ANALYZE, async (_e, input: { imagePath: string; prompt: string; modelPath?: string }) => {
    // İKİ AŞAMALI GÖRSEL AKIŞI — 1. AŞAMA (analiz).
    // API modeli aktifse görsel analizini API'nin KENDİSİ yapar (yerel VL ASLA
    // çalışmaz). Görsel + detaylı analiz prompt'u API'ye multimodal gider,
    // ölçülebilir tasarım spec'i döner; bu spec 2. aşamada (frontier build)
    // tam projeyi kurmak için kullanılır. "Localde hiçbir şey API'yi etkilemez."
    if (hasApiOverride()) {
      try {
        mainWindow?.webContents.send(IPC.VISION_STATUS, { msg: 'API görseli inceliyor…' })
        const dataUrl = await imageToDataUrl(input.imagePath)
        const sys =
          'You are a meticulous senior UI/UX design analyst. You are shown ONE screenshot of a website/app design. Produce a precise, MEASURABLE reconstruction spec that another developer will build from — never write code, only the spec. Report exact hex colors per region, typography, every section top-to-bottom with its layout and real text content, components and their styles. Read colors and text ONLY from the image; never invent template colors. Be exhaustive: if the page has 6 sections, describe all 6.'
        let text = ''
        const out = await promptApi(sys, input.prompt, (t) => {
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
      input.imagePath,
      input.prompt,
      (msg) => {
        mainWindow?.webContents.send(IPC.VISION_STATUS, { msg })
      },
      input.modelPath
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

  ipcMain.handle(IPC.VISION_PREPARE, async () => {
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
      _e,
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
  ipcMain.handle(IPC.IMAGE_MODEL_DOWNLOAD, async (_e, id: string) => {
    const li = await import('./localImageService')
    return li.downloadCatalogModel(id, (msg) => mainWindow?.webContents.send(IPC.IMAGE_DL_STATUS, { msg }))
  })

  // HuggingFace'te ÖZGÜRCE görsel-üretim modeli ara (GGUF bulur gibi).
  ipcMain.handle(IPC.IMAGE_MODEL_SEARCH, async (_e, query: string) => {
    try {
      const li = await import('./localImageService')
      return { ok: true, results: await li.searchImageModels(query) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Arama sonucundan (URL) bir görsel modelini indir.
  ipcMain.handle(IPC.IMAGE_MODEL_DOWNLOAD_URL, async (_e, input: { url: string; file: string }) => {
    const li = await import('./localImageService')
    return li.downloadImageUrl(input.url, input.file, (msg) => mainWindow?.webContents.send(IPC.IMAGE_DL_STATUS, { msg }))
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
  ipcMain.handle(IPC.WHISPER_TRANSCRIBE, async (_e, input: { wav: ArrayBuffer; lang?: string; modelPath?: string }) => {
    try {
      const ws = await import('./whisperService')
      return await ws.transcribe(input.wav, { lang: input.lang, modelPath: input.modelPath }, (msg) =>
        mainWindow?.webContents.send(IPC.WHISPER_PROGRESS, { msg })
      )
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Katalogdan whisper ggml modelini tek-tık indir (ilerleme WHISPER_PROGRESS ile).
  ipcMain.handle(IPC.WHISPER_MODEL_DOWNLOAD, async (_e, id: string) => {
    try {
      const ws = await import('./whisperService')
      return await ws.downloadWhisperModel(id, (msg) => mainWindow?.webContents.send(IPC.WHISPER_PROGRESS, { msg }))
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.ADVISOR_DETECT, async () => {
    return detectHardware()
  })

  ipcMain.handle(IPC.ADVISOR_PLAN, async () => {
    return getAdvisorPlan()
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
      return await importProjectFolder()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Görsel öz-denetim (roadmap 3.3): dev sayfasının ekran görüntüsü.
  ipcMain.handle(IPC.AGENT_CAPTURE_PAGE, async (_e, input: { url: string }) => {
    try {
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
      return await openProjectDir(dir)
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
  ipcMain.handle(IPC.HISTORY_RESTORE, async (_e, projectName: string, hash: string) => {
    try {
      return await historyRestore(projectName, hash)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.HISTORY_RESTORE_GREEN, async (_e, projectName: string) => {
    try {
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
  ipcMain.handle(IPC.MCP_SERVERS, async () => {
    return { servers: await mcpGetServers() }
  })
  ipcMain.handle(IPC.MCP_CALL, async (_e, input: McpCallInput) => {
    return mcpCallTool(input.server, input.tool, input.args || {})
  })
  ipcMain.handle(IPC.MCP_RELOAD, async () => {
    return { servers: await mcpReload() }
  })
  ipcMain.handle(IPC.MCP_GET_CONFIG, async () => {
    return { servers: await mcpReadConfig(), path: mcpConfigPath() }
  })
  ipcMain.handle(IPC.MCP_SET_CONFIG, async (_e, servers: McpServerConfigInput[]) => {
    await mcpWriteConfig(servers)
    return { servers: await mcpReload() }
  })

  // ── 10.2 Serve engine: yerel OpenAI-uyumlu uç ────────────────────────────
  ipcMain.handle(IPC.SERVE_SET, async (_e, input: { enabled: boolean; port?: number }) => {
    if (!input.enabled) {
      stopServe()
      return serveStatus()
    }
    try {
      return await startServe(input.port ?? 8787, {
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
  ipcMain.handle(IPC.PROVIDERS_SET_KEY, (_e, input: { providerId: string; key: string }) =>
    setProviderKey(input.providerId, input.key)
  )
  ipcMain.handle(IPC.PROVIDERS_DELETE_KEY, (_e, providerId: string) => deleteProviderKey(providerId))
  ipcMain.handle(IPC.PROVIDERS_LIST_CONFIGURED, () => listConfiguredProviders())
  ipcMain.handle(IPC.PROVIDERS_ACTIVATE, (_e, input: { providerId: string; model: string; mode: 'off' | 'fix' | 'all'; customBaseUrl?: string }) =>
    activateProvider(input)
  )
  ipcMain.handle(IPC.PROVIDERS_FETCH_MODELS, (_e, input: { providerId: string; customBaseUrl?: string }) =>
    fetchProviderModels(input.providerId, input.customBaseUrl)
  )
  ipcMain.handle(IPC.PROVIDERS_SET_ACTIVE_MODEL, (_e, input: { providerId: string; model: string; customBaseUrl?: string }) =>
    setActiveModel(input)
  )
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

app.on('before-quit', () => {
  disposeWorker()
  void stopDev()
  stopVisionServer()
  mcpShutdown()
  stopServe()
  setKeepAwake(false)
  disposeTray()
})
