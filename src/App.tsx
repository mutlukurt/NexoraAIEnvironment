import { useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatPanel from '@/components/ChatPanel'
import ArtifactsPanel from '@/components/ArtifactsPanel'
import ModelBrowser from '@/components/ModelBrowser'
import SettingsModal from '@/components/SettingsModal'
import { useHfStore } from '@/store/hfStore'
import { useAppStore } from '@/store/appStore'
import logoImg from '@/assets/logo.png'

export default function App() {
  const initHf = useHfStore((s) => s.init)
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)

  useEffect(() => {
    initHf()
  }, [initHf])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f8f9fc] text-slate-800 antialiased">
      {/* Slim leftmost navigation bar */}
      <nav className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-slate-200/80 bg-white py-4">
        <div className="flex flex-col items-center gap-6">
          {/* Logo */}
          <img src={logoImg} className="h-9 w-9 rounded-xl shadow-[0_4px_12px_rgba(95,75,240,0.25)] select-none" alt="NexoraAI Logo" />
          {/* Nav Items */}
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={() => setActiveTab('chat')}
              title="Sohbet"
              className={
                'flex h-10 w-10 items-center justify-center rounded-xl transition ' +
                (activeTab === 'chat'
                  ? 'text-brand-600 bg-brand-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50')
              }
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
            <button
              onClick={() => setActiveTab('code')}
              title="Kod & Dosyalar"
              className={
                'flex h-10 w-10 items-center justify-center rounded-xl transition ' +
                (activeTab === 'code'
                  ? 'text-brand-600 bg-brand-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50')
              }
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </button>
            <button
              onClick={() => useHfStore.getState().setModalOpen(true)}
              title="Model Tarayıcı"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Settings button at the bottom */}
        <button
          onClick={() => window.dispatchEvent(new Event('nexora:openSettings'))}
          title="Ayarlar"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </nav>

      <Sidebar />
      {activeTab === 'chat' ? <ChatPanel /> : <ArtifactsPanel />}
      <ModelBrowser />
      <SettingsModal />
    </div>
  )
}
