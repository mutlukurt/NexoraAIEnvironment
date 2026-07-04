/**
 * CJK token taraması — saf Node.js altında, AYRI süreçte koşar (llamaWorker
 * gibi; node-llama-cpp Electron ana sürecine asla girmez).
 *
 * llama-server motoru TokenBias yerine istek başına logit_bias gönderir;
 * yasaklanacak token kimlikleri bu script ile çıkarılır. Model AĞIRLIKLARI
 * yüklenmez (vocabOnly) — 9 GB'lik model için bile ~1-2 saniye sürer.
 *
 * Kullanım: node cjkScan.js <model.gguf>
 * Çıktı: stdout'a tek satır JSON: {"ids":[...]}
 */
import type { Token } from 'node-llama-cpp'

// llamaWorker.ts'deki CJK_RE ile birebir aynı aralıklar.
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/

async function main(): Promise<void> {
  const modelPath = process.argv[2]
  if (!modelPath) {
    process.stderr.write('kullanım: cjkScan <model.gguf>\n')
    process.exit(2)
  }
  const m = await import('node-llama-cpp')
  // node-llama-cpp log satırları stdout'a karışıp JSON çıktıyı bozmasın.
  const llama = await m.getLlama({ gpu: false, logLevel: m.LlamaLogLevel.disabled })
  const model = await llama.loadModel({ modelPath, vocabOnly: true })

  const vocabSize: number =
    (model as unknown as { fileInfo?: { metadata?: { tokenizer?: { ggml?: { tokens?: unknown[] } } } } })
      .fileInfo?.metadata?.tokenizer?.ggml?.tokens?.length ?? 0

  const ids: number[] = []
  for (let t = 0; t < vocabSize; t++) {
    try {
      if (CJK_RE.test(model.detokenize([t as Token]))) ids.push(t)
    } catch {
      /* tek token çözülemezse atla */
    }
  }
  // process.exit stdout boşalmadan süreci öldürebilir (230KB JSON kesiliyor):
  // çıkışı write callback'ine bağla.
  process.stdout.write(JSON.stringify({ ids }) + '\n', () => process.exit(0))
}

void main().catch((err) => {
  process.stderr.write((err as Error).message + '\n')
  process.exit(1)
})
