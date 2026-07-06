/**
 * Debug Engine 6.2 — lib/tip haritası (VITE'A ÖZEL yükleyici).
 *
 * TypeScript'in lib.*.d.ts dosyaları + @types/react(-dom) DERLEME ANINDA
 * ham metin olarak pakete gömülür (import.meta.glob, lazy chunk) — üretimde
 * node_modules'e, ağa, diske bağımlılık sıfır. Test ortamı (esbuild) bu
 * modülü hiç çağırmaz; tsScan'e fs'ten okunmuş harita verir.
 */
import type { LibMap } from './tsDiagnostics'

// Bilinmeyen bare-import'lar (lucide-react, framer-motion…) tip hatası
// üretmesin: motorun görece-import sınıfı zaten regex katmanında; bare
// modüllerin İÇİ değil, projenin KENDİ kodu denetleniyor.
const AMBIENT = `declare module '*'\n`

export async function loadTsLibs(): Promise<LibMap> {
  const out: LibMap = { '/types/ambient.d.ts': AMBIENT }
  // DİKKAT: renderer'ın vite root'u `src/` — mutlak '/node_modules/…' deseni
  // src altında arandığı için HİÇ eşleşmez (canlı ders: chunk 0.7 kB çıktı).
  // Desenler bu dosyaya (src/lib/) göre yazılmalı.
  const libGlob = import.meta.glob('../../node_modules/typescript/lib/lib*.d.ts', {
    query: '?raw',
    import: 'default'
  })
  for (const [path, load] of Object.entries(libGlob)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    out['/libs/' + name] = (await load()) as string
  }
  const typeGlobs: Array<[string, Record<string, () => Promise<unknown>>]> = [
    ['/types/react/', import.meta.glob('../../node_modules/@types/react/*.d.ts', { query: '?raw', import: 'default' })],
    ['/types/react-dom/', import.meta.glob('../../node_modules/@types/react-dom/*.d.ts', { query: '?raw', import: 'default' })]
  ]
  for (const [prefix, glob] of typeGlobs) {
    for (const [path, load] of Object.entries(glob)) {
      const name = path.slice(path.lastIndexOf('/') + 1)
      out[prefix + name] = (await load()) as string
    }
  }
  return out
}
