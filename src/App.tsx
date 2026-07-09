import { useEffect, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatPanel from '@/components/ChatPanel'
import ArtifactsPanel from '@/components/ArtifactsPanel'
import ModelBrowser from '@/components/ModelBrowser'
import SettingsModal from '@/components/SettingsModal'
import WelcomeSetup from '@/components/WelcomeSetup'
import DiffModal from '@/components/DiffModal'
import PermissionModal from '@/components/PermissionModal'
import CommandPalette from '@/components/CommandPalette'
import { useHfStore } from '@/store/hfStore'
import { useAppStore } from '@/store/appStore'
import { useSettingsStore } from '@/store/settingsStore'
import { shouldNotifyDone } from '@/lib/notifyDecision'

export default function App() {
  const initHf = useHfStore((s) => s.init)
  const activeTab = useAppStore((s) => s.activeTab)
  const generating = useAppStore((s) => s.generating)
  const language = useAppStore((s) => s.language)
  const prevGen = useRef(false)
  const runStart = useRef(0)

  useEffect(() => {
    initHf()
  }, [initHf])

  // 10.5 — koşu sinyalinden (generating) uyku-engelleyici + bitiş bildirimi sür.
  // Tek doğruluk kaynağı: turlar, kuyruk, build'ler hepsi generating'i çevirir.
  useEffect(() => {
    const { notifyOnDone, keepAwakeOnRun } = useSettingsStore.getState()
    if (generating && !prevGen.current) {
      runStart.current = Date.now()
      if (keepAwakeOnRun) void window.nexora.system?.keepAwake(true)
    } else if (!generating && prevGen.current) {
      void window.nexora.system?.keepAwake(false)
      const secs = Math.round((Date.now() - runStart.current) / 1000)
      // Uzun koşuları (≥8sn) ve pencere arka plandaysa haber ver (main de kontrol eder).
      if (shouldNotifyDone({ enabled: notifyOnDone, elapsedSec: secs, focused: document.hasFocus() })) {
        void window.nexora.system?.notify({
          title: 'NexoraAI',
          body: language === 'tr' ? `Üretim tamamlandı (${secs}sn).` : `Generation finished (${secs}s).`
        })
      }
    }
    prevGen.current = generating
  }, [generating, language])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-bg text-ink-text antialiased">
      <Sidebar />
      {activeTab === 'chat' ? <ChatPanel /> : <ArtifactsPanel />}
      <ModelBrowser />
      <SettingsModal />
      <WelcomeSetup />
      <DiffModal />
      <PermissionModal />
      <CommandPalette />
    </div>
  )
}
