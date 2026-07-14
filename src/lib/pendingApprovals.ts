/**
 * 15.1 — Reboot-dayanıklı bekleyen izinler: saf çekirdek (Piebald yol haritası).
 *
 * Bir [RUN]/[FETCH]/[MCP] onay istemi eskiden yalnız bellekteydi; çökme/kapanma
 * onu SESSİZCE kaybediyordu. Artık SessionData.pendingApprovals'a serileşir:
 * relaunch'ta PermissionModal geri gelir, onaylanırsa yapılandırılmış eylemler
 * (runs/fetches/mcp) yeniden koşar. Bu modül saf — `npm run test:approvalpersist` koşar.
 */

import type { AgentDirectives } from './agentActions'

/** Diske serileşen bekleyen izin kaydı (SessionData.pendingApprovals öğesiyle aynı şekil). */
export interface PendingApproval {
  id: string
  /** Yalnız GÖSTERİM (PermissionModal) — insan-okur özet. */
  items: Array<{ kind: 'run' | 'fetch' | 'mcp'; text: string; reason?: string }>
  runs: string[]
  fetches: Array<{ url: string; path: string }>
  mcp: Array<{ server: string; tool: string; args: Record<string, unknown> }>
  createdAt: number
}

/**
 * Bekleyen izinden yeniden-çalıştırılabilir AgentDirectives kur — YALNIZ risk sınıfı
 * (runs/fetches/mcp) taşınır; kalan tüm direktif alanları boştur (reboot re-exec'i
 * kapsam-dışı eylemleri diriltmez). executeDirectives'e doğrudan verilebilir.
 */
export function reconstructDirectives(pa: PendingApproval): AgentDirectives {
  return {
    pkgs: [],
    fonts: [],
    fetches: pa.fetches,
    runs: pa.runs,
    dev: false,
    mcp: pa.mcp,
    imgs: [],
    assetAdd: false,
    build: false,
    searches: [],
    symbols: [],
    edits: []
  }
}
