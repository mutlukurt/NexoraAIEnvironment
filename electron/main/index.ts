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
  disposeWorker
} from './llamaService'
import {
  searchModels,
  listLocalModels,
  downloadModel,
  cancelDownload
} from './hfService'
import {
  runCommand,
  fetchToFile,
  addGoogleFont,
  syncWorkspace,
  startDev,
  stopDev,
  getDevUrl,
  exportProject,
  buildCheck
} from './agentService'
import { analyzeImage, stopVisionServer } from './visionService'
import {
  IPC,
  type ChatSendInput,
  type HfDownloadInput,
  type ArtifactExportInput,
  type AgentRunInput,
  type AgentFetchInput,
  type AgentFontInput,
  type AgentDevInput
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

  ipcMain.handle(IPC.MODEL_LOAD, async (_e, path: string, enableGpu?: boolean) => {
    try {
      let lastSent = 0
      const info = await loadModel(path, enableGpu, (stage, progress) => {
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
      mainWindow.webContents.send(IPC.CHAT_STREAM, { done: true, full })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.CHAT_ABORT, async () => {
    await abortChat()
    return { ok: true }
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
    return runCommand(input.projectName, input.command)
  })

  ipcMain.handle(IPC.AGENT_FETCH, async (_e, input: AgentFetchInput) => {
    await syncWorkspace(input.projectName, input.files)
    return fetchToFile(input.projectName, input.url, input.path)
  })

  ipcMain.handle(IPC.AGENT_FONT, async (_e, input: AgentFontInput) => {
    await syncWorkspace(input.projectName, input.files)
    return addGoogleFont(input.projectName, input.family, input.baseDir)
  })

  ipcMain.handle(IPC.AGENT_DEV_START, async (_e, input: AgentDevInput) => {
    const res = await startDev(input.projectName, input.files, (msg) => {
      mainWindow?.webContents.send(IPC.AGENT_DEV_STATUS, { msg })
    })
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
    return buildCheck(input.projectName)
  })

  ipcMain.handle(IPC.AGENT_DEV_STOP, async () => {
    await stopDev()
    return { ok: true }
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

  ipcMain.handle(IPC.VISION_ANALYZE, async (_e, input: { imagePath: string; prompt: string }) => {
    return analyzeImage(input.imagePath, input.prompt, (msg) => {
      mainWindow?.webContents.send(IPC.VISION_STATUS, { msg })
    })
  })

  ipcMain.handle(IPC.AGENT_DEV_STATUS, async () => {
    return { url: getDevUrl() }
  })
}

void app.whenReady().then(async () => {
  registerIpc()
  createWindow()

  if (process.env['NEXORA_SELFTEST']) {
    const path = process.env['NEXORA_SELFTEST']
    try {
      console.log('[selftest] loading', path)
      const info = await loadModel(path)
      console.log('[selftest] loaded', info.name, 'gpu=' + info.gpu, 'ctx=' + info.contextSize)
      const full = await chat({ prompt: 'Bir kere upon a time', options: { maxTokens: 30 } }, (t) => process.stdout.write(t))
      console.log('\n[selftest] response len=' + full.length)
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
})
