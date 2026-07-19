import { build } from 'esbuild'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'nexora-ipc-inventory-'))
const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(entry, `export * from '${join(repo, 'electron/shared/ipcCapabilityInventory.ts')}'\n`)
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile })
const { IPC_CAPABILITY_INVENTORY } = await import(pathToFileURL(outfile).href)

let pass = 0
let fail = 0
const check = (name, condition, detail = '') => {
  if (condition) { pass++; console.log('✓', name) }
  else { fail++; console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const preload = readFileSync(join(repo, 'electron/preload/index.ts'), 'utf8')
const exposed = [...preload.matchAll(/ipcRenderer\.invoke\(IPC\.([A-Z0-9_]+)/g)].map((m) => m[1])
const exposedUnique = [...new Set(exposed)].sort()
const inventoried = Object.keys(IPC_CAPABILITY_INVENTORY).sort()
const missing = exposedUnique.filter((name) => !inventoried.includes(name))
const stale = inventoried.filter((name) => !exposedUnique.includes(name))

check('every preload invoke has an authoritative boundary class', missing.length === 0, missing.join(', '))
check('inventory contains no stale or imaginary invoke', stale.length === 0, stale.join(', '))
check('no IPC name is classified more than once', inventoried.length === new Set(inventoried).size)
check('inventory covers the full bridge (90+ invokes)', inventoried.length >= 90, String(inventoried.length))

const main = readFileSync(join(repo, 'electron/main/index.ts'), 'utf8')
const guardedNativeHandlers = Object.entries(IPC_CAPABILITY_INVENTORY)
  .filter(([, boundary]) => boundary === 'native-confirm')
  .filter(([name]) => {
    const match = new RegExp(`ipcMain\\.handle\\(\\s*IPC\\.${name}`).exec(main)
    const start = match?.index ?? -1
    if (start < 0) return false
    const next = main.indexOf('ipcMain.handle(IPC.', start + 20)
    const segment = main.slice(start, next < 0 ? main.length : next)
    return /confirmDirectPrivilegedEffect|confirmNativeCapability|authorizeNativeCapability|dialog\.showMessageBox/.test(segment)
  })
check(
  'every native-confirm handler contains a main-owned confirmation gate',
  guardedNativeHandlers.length === Object.values(IPC_CAPABILITY_INVENTORY).filter((v) => v === 'native-confirm').length,
  `${guardedNativeHandlers.length}/${Object.values(IPC_CAPABILITY_INVENTORY).filter((v) => v === 'native-confirm').length}`
)
check('external browser navigation requires main native confirmation', /setWindowOpenHandler[\s\S]*confirmNativeCapability[\s\S]*shell\.openExternal/.test(main))
check('main-owned modal confirmation is sandboxed and defaults keyboard focus to Deny', /modal:\s*true/.test(main) && /sandbox:\s*true/.test(main) && /nodeIntegration:\s*false/.test(main) && /id=\\?"deny\\?" autofocus/.test(main))
check('browser automation rejects non-loopback URLs', /DEBUG_INSPECT[\s\S]*isLoopbackHttpUrl/.test(main) && /AGENT_CAPTURE_PAGE[\s\S]*isLoopbackHttpUrl/.test(main))
check('ZIP export cannot accept renderer savePath bypass', !/savePath/.test(preload) && !/input\.savePath/.test(main))
check('MCP service has a main-owned lifecycle lock', /let lifecycleAuthorized = false/.test(readFileSync(join(repo, 'electron/main/mcpService.ts'), 'utf8')))
check('renderer uses context isolation, no Node integration, and Chromium sandbox', /contextIsolation:\s*true/.test(main) && /nodeIntegration:\s*false/.test(main) && /sandbox:\s*true/.test(main))
const keyStore = readFileSync(join(repo, 'electron/main/providerKeysService.ts'), 'utf8')
const settingsStore = readFileSync(join(repo, 'src/store/settingsStore.ts'), 'utf8')
const persistenceEnd = settingsStore.indexOf('// Hibrit API (4.1)')
const persistedSettings = settingsStore.slice(settingsStore.lastIndexOf('localStorage.setItem(', persistenceEnd), persistenceEnd)
// Keys are encrypted with the OS keychain WHEN it is available, and the store
// records which mode it used so the UI can warn. A base64 fallback is allowed
// only for keyring-less Linux (else the user's existing key becomes unreadable,
// v0.25.0 regression) — never a silent plaintext store, and never localStorage.
check('provider credentials use safeStorage when available',
  /safeStorage\.encryptString\(key\)/.test(keyStore)
    && /store\.encrypted = enc/.test(keyStore)
    && /store\.encrypted && encAvailable\(\)/.test(keyStore))
check('legacy renderer API credentials are migrated out of localStorage', /delete parsed\.apiKey/.test(settingsStore) && !/apiKey/.test(persistedSettings))

rmSync(work, { recursive: true, force: true })
console.log(`\nipc inventory: ${pass} passed, ${fail} failed (${inventoried.length} invokes)`)
if (fail) process.exit(1)
