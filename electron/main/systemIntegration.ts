/**
 * 10.5 — İşletim sistemi tümleşiği: bildirim + powerSaveBlocker + tray.
 *
 * Uzun koşular (dakikalarca süren üretim/onarım) için: (a) tamamlanınca pencere
 * arka plandaysa yerel bildirim, (b) koşarken uyku engelleyici (makine uyursa
 * llama-server bağlantısı kopar), (c) sistem tepsisi ikonu (göster/çıkış).
 * Renderer, holistik `generating` sinyalinden bunları sürer (logRepair boğaz
 * noktasının kardeşi — tek doğruluk kaynağı).
 */
import { app, Tray, Menu, nativeImage, Notification, powerSaveBlocker, type BrowserWindow } from 'electron'
import { join } from 'node:path'

let tray: Tray | null = null
let blockerId: number | null = null

const iconPath = join(__dirname, '../renderer/logo.png')

export function setupTray(getWin: () => BrowserWindow | null): void {
  if (tray) return
  let img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 })
  try {
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  } catch {
    return // bazı ortamlarda (headless) tray yok — sessiz geç
  }
  tray.setToolTip('NexoraAI')
  const show = () => {
    const w = getWin()
    if (!w) return
    if (!w.isVisible()) w.show()
    w.focus()
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'NexoraAI', enabled: false },
      { type: 'separator' },
      { label: 'Göster / Odakla', click: show },
      { label: 'Çıkış', click: () => app.quit() }
    ])
  )
  tray.on('click', show)
}

export function disposeTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* yok */
  }
  tray = null
}

/** Koşarken makinenin uyumasını engelle; koşu bitince serbest bırak. */
export function setKeepAwake(on: boolean): void {
  if (on) {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension')
    }
  } else if (blockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    } catch {
      /* yok */
    }
    blockerId = null
  }
}

export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    let icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
    new Notification({ title, body, icon, silent: false }).show()
  } catch {
    /* bildirim başarısızsa sessiz geç */
  }
}
