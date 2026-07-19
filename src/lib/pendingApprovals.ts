/**
 * 15.1 — Reboot-dayanıklı bekleyen izinler: saf çekirdek (Piebald yol haritası).
 *
 * Bir [RUN]/[FETCH]/[MCP] onay istemi eskiden yalnız bellekteydi; çökme/kapanma
 * onu SESSİZCE kaybediyordu. Artık SessionData.pendingApprovals'a serileşir:
 * relaunch'ta PermissionModal geri gelir, onaylanırsa yapılandırılmış eylemler
 * (runs/fetches/mcp) yeniden koşar. Bu modül saf — `npm run test:approvalpersist` koşar.
 */

import type { AgentDirectives } from './agentActions'
import type { PermissionItemKind } from '@shared/ipc'

/** Diske serileşen bekleyen izin kaydı (SessionData.pendingApprovals öğesiyle aynı şekil). */
export interface PendingApproval {
  id: string
  /** Yalnız GÖSTERİM (PermissionModal) — insan-okur özet. */
  items: Array<{ kind: PermissionItemKind; text: string; reason?: string; impact?: string }>
  runs: string[]
  pkgs?: string[]
  fonts?: string[]
  fetches: Array<{ url: string; path: string }>
  mcp: Array<{ server: string; tool: string; args: Record<string, unknown> }>
  dev?: boolean
  createdAt: number
}

/**
 * Bekleyen izinden yeniden-çalıştırılabilir AgentDirectives kur — YALNIZ risk sınıfı
 * (runs/fetches/mcp) taşınır; kalan tüm direktif alanları boştur (reboot re-exec'i
 * kapsam-dışı eylemleri diriltmez). executeDirectives'e doğrudan verilebilir.
 */
export function reconstructDirectives(pa: PendingApproval): AgentDirectives {
  return {
    pkgs: pa.pkgs ?? [],
    fonts: pa.fonts ?? [],
    fetches: pa.fetches,
    runs: pa.runs,
    dev: pa.dev === true,
    mcp: pa.mcp,
    imgs: [],
    assetAdd: false,
    build: false,
    chat: false,
    searches: [],
    symbols: [],
    edits: []
  }
}
