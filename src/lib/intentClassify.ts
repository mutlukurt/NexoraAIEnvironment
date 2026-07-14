/**
 * NİYET-TABANLI (Pattern B) — her yeni turda niyeti KELİME değil MODEL belirler.
 *
 * Kullanıcı ilkesi (2026-07-14): "keyword ile yaptığımızda yanlış yapabiliyor;
 * niyet-tabanlı sorunsuz çalışıyor — her yer böyle olmalı." Bu yüzden looksLikeBuild
 * /looksLikeChatIntent/FIX_WORDS keyword sezgileri artık YALNIZ yedek (model yoksa);
 * model varken niyeti tek-kelimelik hızlı bir sınıflandırma turuyla MODEL söyler.
 *
 * Bu dosya SAFtır: sınıflandırma prompt'unu kurar + modelin tek-kelime cevabını
 * ayrıştırır. Asıl model çağrısı appStore'da (model2.complete, yerel isolate VEYA API).
 * `npm run test:intentclass` bunu kilitler.
 */

export type TurnIntent = 'build' | 'edit' | 'fix' | 'chat'

export interface IntentContext {
  /** Oturumda mevcut proje dosyası var mı? */
  hasFiles: boolean
  /** O an düzeltilecek bir derleme/çalışma hatası var mı? */
  hasBuildErr: boolean
}

export const INTENT_SYSTEM =
  'You are a fast intent classifier for a coding assistant. Read the user message and reply with EXACTLY ONE WORD naming what they want — nothing else, no punctuation, no explanation.'

/** Bağlama göre geçerli seçenekler (boş oturumda BUILD/CHAT; projede EDIT/CHAT [+FIX]). */
export function allowedIntents(ctx: IntentContext): TurnIntent[] {
  if (!ctx.hasFiles) return ['build', 'chat']
  return ctx.hasBuildErr ? ['edit', 'fix', 'chat'] : ['edit', 'chat']
}

/** Modelin tek-kelime cevabı için sınıflandırma prompt'u. Küçük modelde (3B) isabet
 *  için FEW-SHOT örnekler + kısa tanımlar. Örnekler bağlama göre seçilir. */
export function buildIntentPrompt(msg: string, ctx: IntentContext): string {
  const opts: Record<TurnIntent, string> = {
    build: 'BUILD = create a NEW website/app/page/project from scratch (e.g. "make me a portfolio site", "bana bir landing page yap", "build a dashboard")',
    edit: 'EDIT = change/add/remove something in the EXISTING project (e.g. "change the navbar color", "add a contact form", "hero başlığını büyüt")',
    fix: 'FIX = fix the current build/compile/runtime error (e.g. "fix it", "düzelt", "çalışmıyor onar")',
    chat: 'CHAT = a question, discussion, opinion, explanation or small talk, with NO code change (e.g. "what is React?", "nasılsın", "hangisi daha iyi", "bunu açıkla")'
  }
  const allowed = allowedIntents(ctx)
  const defs = allowed.map((k) => '- ' + opts[k]).join('\n')
  // Bağlama uygun few-shot örnekler (küçük modelde en-net kararı verdirir).
  const shots: string[] = ctx.hasFiles
    ? [
        'Message: "add a pricing section" -> EDIT',
        'Message: "renkleri koyu temaya çevir" -> EDIT',
        ...(ctx.hasBuildErr ? ['Message: "düzelt" -> FIX', 'Message: "hala hata veriyor onar" -> FIX'] : []),
        'Message: "bu proje ne işe yarıyor" -> CHAT',
        'Message: "which state library is better here" -> CHAT'
      ]
    : [
        'Message: "bana modern bir portfolyo sitesi yap" -> BUILD',
        'Message: "make me a landing page for a coffee shop" -> BUILD',
        'Message: "e-ticaret paneli oluştur" -> BUILD',
        'Message: "react nedir açıkla" -> CHAT',
        'Message: "merhaba nasılsın" -> CHAT'
      ]
  const ctxNote = ctx.hasFiles
    ? `There is an existing project${ctx.hasBuildErr ? ' and a current build error' : ''}.`
    : 'There is no project yet (empty session).'
  const words = allowed.map((k) => k.toUpperCase()).join(', ')
  return `You classify the user's intent for a coding assistant. ${ctxNote}

Categories:
${defs}

Examples:
${shots.join('\n')}

Now classify this message:
"""
${(msg ?? '').slice(0, 1000)}
"""

Answer with ONLY one word (${words}). No punctuation, no explanation.`
}

/**
 * Modelin ham cevabından niyeti çöz. Bağlamda geçerli değilse (ör. FIX ama hata yok)
 * düşürülür. Belirsiz/boş → null (çağıran keyword yedeğine düşer). Cümle içinde geçse
 * de yakalar ("The answer is BUILD.").
 */
export function parseIntent(raw: string, ctx: IntentContext): TurnIntent | null {
  const t = (raw ?? '').toUpperCase()
  const allowed = allowedIntents(ctx)
  // Öncelik: en spesifik önce (FIX > EDIT > BUILD > CHAT) — çok-kelime cevapta ilk anlamlıyı al.
  const order: TurnIntent[] = ['fix', 'edit', 'build', 'chat']
  for (const k of order) {
    if (!allowed.includes(k)) continue
    if (new RegExp(`\\b${k.toUpperCase()}\\b`).test(t)) return k
  }
  return null
}
