import { useEffect } from 'react'
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

export default function App() {
  const initHf = useHfStore((s) => s.init)
  const activeTab = useAppStore((s) => s.activeTab)

  useEffect(() => {
    initHf()
  }, [initHf])

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
