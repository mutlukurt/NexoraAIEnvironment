/**
 * 10.9 — Sağlayıcı kataloğu üretici: models.dev/api.json → electron/shared/providers.ts
 *
 * Çalıştır: node scripts/gen-providers.mjs
 * models.dev'in TAM sağlayıcı listesini (150+) çekip OFFLINE gömülü katalog üretir.
 * Adapter models.dev npm alanından (@ai-sdk/anthropic → native), base URL api
 * alanından veya birinci-taraf için küratörlü haritadan.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(repo, 'electron/shared/providers.ts')

// Birinci-taraf/AI-SDK sağlayıcıların base URL'i (models.dev api vermiyor — SDK-içi).
const CURATED = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai', groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1', deepseek: 'https://api.deepseek.com/v1', xai: 'https://api.x.ai/v1',
  cohere: 'https://api.cohere.ai/compatibility/v1', cerebras: 'https://api.cerebras.ai/v1',
  perplexity: 'https://api.perplexity.ai', upstage: 'https://api.upstage.ai/v1/solar',
  inception: 'https://api.inceptionlabs.ai/v1', togetherai: 'https://api.together.xyz/v1',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1', deepinfra: 'https://api.deepinfra.com/v1/openai',
  'novita-ai': 'https://api.novita.ai/v3/openai', nebius: 'https://api.studio.nebius.ai/v1',
  baseten: 'https://inference.baseten.co/v1', scaleway: 'https://api.scaleway.ai/v1',
  ovhcloud: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', vultr: 'https://api.vultrinference.com/v1',
  digitalocean: 'https://inference.do-ai.run/v1', openrouter: 'https://openrouter.ai/api/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1', requesty: 'https://router.requesty.ai/v1',
  fastrouter: 'https://go.fastrouter.ai/api/v1', huggingface: 'https://router.huggingface.co/v1',
  'github-models': 'https://models.github.ai/inference', 'github-copilot': 'https://api.githubcopilot.com',
  moonshotai: 'https://api.moonshot.ai/v1', zhipuai: 'https://open.bigmodel.cn/api/paas/v4',
  alibaba: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', minimax: 'https://api.minimax.chat/v1',
  stepfun: 'https://api.stepfun.com/v1', siliconflow: 'https://api.siliconflow.com/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1', poe: 'https://api.poe.com/v1', chutes: 'https://llm.chutes.ai/v1',
  venice: 'https://api.venice.ai/api/v1', morph: 'https://api.morphllm.com/v1',
  friendli: 'https://api.friendli.ai/serverless/v1', clarifai: 'https://api.clarifai.com/v2/ext/openai/v1',
  sarvam: 'https://api.sarvam.ai/v1', wandb: 'https://api.inference.wandb.ai/v1'
}
const LOCAL_IDS = new Set(['lmstudio', 'ollama', 'jan', 'vllm'])
const GATEWAY_IDS = new Set(['openrouter', 'vercel', 'requesty', 'fastrouter', 'crof', 'huggingface',
  'github-models', 'github-copilot', 'opencode', 'opencode-go', 'llmgateway', 'merge-gateway', 'orcarouter',
  'nano-gpt', 'aihubmix', 'helicone', 'litellm', 'cloudflare-ai-gateway', 'trustedrouter', 'zenmux',
  'routing-run', 'anyapi', 'llmtr', '302ai'])

const d = await (await fetch('https://models.dev/api.json')).json()
const rows = []
for (const [id, p] of Object.entries(d)) {
  const npm = p.npm || ''
  rows.push({
    id, name: p.name || id, baseUrl: p.api || CURATED[id] || '',
    adapter: /anthropic/.test(npm) && !/openai/.test(npm) ? 'anthropic' : 'openai',
    keyEnv: Array.isArray(p.env) && p.env.length ? p.env[0] : undefined,
    local: LOCAL_IDS.has(id), gateway: GATEWAY_IDS.has(id)
  })
}
const have = new Set(rows.map((r) => r.id))
for (const e of [
  { id: 'ollama', name: 'Ollama (yerel)', baseUrl: 'http://localhost:11434/v1', adapter: 'openai', local: true },
  { id: 'jan', name: 'Jan (yerel)', baseUrl: 'http://localhost:1337/v1', adapter: 'openai', local: true },
  { id: 'vllm', name: 'vLLM (yerel/self-host)', baseUrl: 'http://localhost:8000/v1', adapter: 'openai', local: true },
  { id: 'llamacpp', name: 'llama.cpp server (yerel)', baseUrl: 'http://localhost:8080/v1', adapter: 'openai', local: true }
]) if (!have.has(e.id)) rows.push(e)
rows.push({ id: 'custom', name: 'Özel (OpenAI-uyumlu)', baseUrl: '', adapter: 'openai', keyEnv: 'API_KEY' })

const TOP = ['openai', 'anthropic', 'google', 'xai', 'mistral', 'deepseek', 'groq', 'openrouter', 'ollama', 'lmstudio']
rows.sort((a, b) => {
  const ai = TOP.indexOf(a.id), bi = TOP.indexOf(b.id)
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  return a.name.localeCompare(b.name)
})
const q = (s) => JSON.stringify(s)
const arr = rows.map((r) => {
  const parts = [`id: ${q(r.id)}`, `name: ${q(r.name)}`, `baseUrl: ${q(r.baseUrl)}`, `adapter: ${q(r.adapter)}`]
  if (r.keyEnv) parts.push(`keyEnv: ${q(r.keyEnv)}`)
  if (r.local) parts.push('local: true')
  if (r.gateway) parts.push('gateway: true')
  return '  { ' + parts.join(', ') + ' }'
}).join(',\n')

const H = String.fromCharCode(96) // backtick
const file = [
  '/**',
  ' * 10.9 — Sağlayıcı kataloğu (models.dev TAM listesinden üretilmiş, ÇEVRİMDIŞI gömülü).',
  ' * ÜRETİLDİ: node scripts/gen-providers.mjs — ELLE DÜZENLEME (models.dev/api.json otoritedir).',
  ' * Adapter: @ai-sdk/anthropic → native /v1/messages; geri kalanı OpenAI-uyumlu (/chat/completions).',
  ' * base URL boş veya ${VAR} şablonlu olanlar kaynak-özel → kullanıcı doldurur. YEREL varsayılan, opt-in.',
  ' */',
  "export type ProviderAdapter = 'openai' | 'anthropic'",
  '',
  'export interface ProviderInfo {',
  '  id: string',
  '  name: string',
  '  baseUrl: string',
  '  adapter: ProviderAdapter',
  '  keyEnv?: string',
  '  local?: boolean',
  '  gateway?: boolean',
  '  docs?: string',
  '}',
  '',
  'export const PROVIDERS: ProviderInfo[] = [',
  arr,
  ']',
  '',
  'export function findProvider(id: string): ProviderInfo | undefined {',
  '  return PROVIDERS.find((p) => p.id === id)',
  '}',
  '',
  "export function dataDestinationNote(p: ProviderInfo, lang: 'tr' | 'en' = 'tr'): string {",
  "  if (p.local) return lang === 'tr' ? 'Yerel süreç — veri makineden çıkmaz' : 'Local process — data stays on the machine'",
  '  return lang === ' + q('tr') + ' ? ' + H + 'Veri ${p.name} sunucularına gider' + H + ' : ' + H + 'Data goes to ${p.name}' + H,
  '}',
  ''
].join('\n')
writeFileSync(OUT, file)
console.log(`providers.ts yazıldı: ${rows.length} sağlayıcı (${rows.filter((r) => r.local).length} yerel, ${rows.filter((r) => r.gateway).length} gateway)`)
