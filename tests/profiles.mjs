/**
 * 15.2 — Config Profiles regresyon takımı.
 *
 * Önyükleme profillerinin (Ideation/Coding/Frontend) davranış sözleşmesini + saf
 * yardımcıları (directiveAllowed / effectiveTrustTier / mcpAllowed / getProfileById)
 * sabitler. Çalıştırma: npm run test:profiles
 */
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-profiles-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/configProfiles.ts')}'\n`)
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile,
  alias: { '@shared': join(repo, 'electron/shared') }
})
const api = await import(pathToFileURL(outfile).href)

let pass = 0, fail = 0
const failures = []
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('✓', name) }
  else { fail++; failures.push(`✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const P = api.PRESET_PROFILES
const byId = (id) => api.getProfileById(P, id)
const ideation = byId('ideation'), coding = byId('coding'), frontend = byId('frontend-build')

// 1) Üç preset tanımlı + benzersiz id
check('3 önyükleme profili', P.length === 3, String(P.length))
check('id\'ler benzersiz', new Set(P.map((p) => p.id)).size === 3)
check('hepsi builtin', P.every((p) => p.builtin === true))
check('varsayılan = coding', api.DEFAULT_CONFIG_PROFILE_ID === 'coding')

// 2) Ideation = beyin fırtınası: read tier + üretim direktifleri engelli
check('Ideation trustTier=read', ideation.trustTier === 'read', ideation.trustTier)
check('Ideation RUN engelli', ideation.blockedDirectives.includes('RUN'))
check('Ideation BUILD engelli', ideation.blockedDirectives.includes('BUILD'))
check('Ideation sistem-prompt IDEATION içerir', /IDEATION/i.test(ideation.systemPromptAddition))
check('Ideation yaratıcı sıcaklık (>0.5)', ideation.sampling.temperature > 0.5, String(ideation.sampling.temperature))

// 3) Coding = tam yetki
check('Coding trustTier=full', coding.trustTier === 'full', coding.trustTier)
check('Coding hiçbir direktif engellemez', coding.blockedDirectives.length === 0)
check('Coding hassas sıcaklık (≤0.3)', coding.sampling.temperature <= 0.3, String(coding.sampling.temperature))

// 4) Frontend = ask-first, ağ/MCP kapalı
check('Frontend trustTier=auto', frontend.trustTier === 'auto', frontend.trustTier)
check('Frontend FETCH engelli', frontend.blockedDirectives.includes('FETCH'))
check('Frontend RUN engelli DEĞİL', !frontend.blockedDirectives.includes('RUN'))

// 5) directiveAllowed
check('directiveAllowed: Ideation RUN → false', api.directiveAllowed(ideation, 'RUN') === false)
check('directiveAllowed: Coding RUN → true', api.directiveAllowed(coding, 'RUN') === true)
check('directiveAllowed: küçük harf de eşleşir', api.directiveAllowed(ideation, 'run') === false)
check('directiveAllowed: null profil → hepsi izinli', api.directiveAllowed(null, 'RUN') === true)

// 6) effectiveTrustTier — profil kısıtlayabilir, global ayarı yükseltemez
check('effectiveTrustTier: profil kısıtlar', api.effectiveTrustTier(ideation, 'full') === 'read')
check('effectiveTrustTier: Coding global auto ayarını full yapmaz', api.effectiveTrustTier(coding, 'auto') === 'auto')
check('effectiveTrustTier: Frontend global read ayarını auto yapmaz', api.effectiveTrustTier(frontend, 'read') === 'read')
check('effectiveTrustTier: null → global', api.effectiveTrustTier(null, 'auto') === 'auto')

// 7) mcpAllowed (boş enabledMcps → hepsi)
check('mcpAllowed: boş liste → izinli', api.mcpAllowed(coding, 'herhangi') === true)
check('mcpAllowed: null profil → izinli', api.mcpAllowed(null, 'x') === true)
const scoped = { ...coding, enabledMcps: ['files'] }
check('mcpAllowed: listede olan izinli', api.mcpAllowed(scoped, 'files') === true)
check('mcpAllowed: listede olmayan engelli', api.mcpAllowed(scoped, 'slack') === false)

// 8) getProfileById
check('getProfileById: bilinmeyen → null', byId('yok') === null)
check('getProfileById: null id → null', api.getProfileById(P, null) === null)

rmSync(work, { recursive: true, force: true })
console.log(`\nprofiles: ${pass} geçti, ${fail} kaldı`)
if (fail > 0) { console.error('\n' + failures.join('\n')); process.exit(1) }
