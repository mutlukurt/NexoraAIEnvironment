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
import { analyzeImage, stopVisionServer, ensureVisionReady } from './visionService'
import { detectHardware } from './advisorService'
import { listSessions, saveSession, loadSession, deleteSession } from './sessionsService'
import { getRules, setRules } from './rulesService'
import {
  IPC,
  type ChatSendInput,
  type HfDownloadInput,
  type ArtifactExportInput,
  type AgentRunInput,
  type AgentFetchInput,
  type AgentFontInput,
  type AgentDevInput,
  type SessionData
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

  ipcMain.handle(IPC.VISION_PREPARE, async () => {
    return ensureVisionReady((msg) => {
      mainWindow?.webContents.send(IPC.VISION_STATUS, { msg })
    })
  })

  ipcMain.handle(IPC.ADVISOR_DETECT, async () => {
    return detectHardware()
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
}

void app.whenReady().then(async () => {
  registerIpc()
  createWindow()

  if (process.env['NEXORA_SELFTEST']) {
    const path = process.env['NEXORA_SELFTEST']
    const gpu = process.env['NEXORA_SELFTEST_GPU'] === '1'
    try {
      console.log('[selftest] loading', path, 'gpu =', gpu)
      const info = await loadModel(path, gpu)
      console.log('[selftest] loaded', info.name, 'gpu=' + info.gpu, 'layers=' + info.gpuLayers + '/' + info.totalLayers, 'ctx=' + info.contextSize)
      const t1 = Date.now()
      const prompt1 = process.env['NEXORA_SELFTEST_PROMPT'] ?? 'My favorite fruit is mango. Reply with just: OK'
      const full = await chat({ prompt: prompt1, options: { maxTokens: process.env['NEXORA_SELFTEST_PROMPT'] ? 48 : 8, temperature: 0 } }, (t) => process.stdout.write(t))
      console.log(`\n[selftest] turn1 len=${full.length} (${Date.now() - t1}ms)`)
      // İkinci tur: sohbet geçmişi motorda yaşıyor mu? (cevap ilk turdan gelmeli)
      const t2 = Date.now()
      const full2 = await chat({ prompt: 'What is my favorite fruit? One word.', options: { maxTokens: 8, temperature: 0 } }, (t) => process.stdout.write(t))
      console.log(`\n[selftest] turn2 answer="${full2.trim()}" (${Date.now() - t2}ms)`)
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
})
