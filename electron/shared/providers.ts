/**
 * 10.9 — Sağlayıcı kataloğu (models.dev / OpenCode tarzı, ÇEVRİMDIŞI gömülü).
 *
 * KULLANICI ISRARI: OpenCode'daki TÜM sağlayıcılar eksiksiz — curated-few DEĞİL.
 * Çoğu OpenAI-uyumlu → base-URL preset'iyle açılır (o yüzden tam liste ucuz);
 * native adapter yalnız Anthropic; gateway'ler (OpenRouter/Vercel/Requesty…)
 * uzun kuyruğu kapatır. Google, kendi OpenAI-uyumlu ucuyla 'openai' adapter'ında.
 *
 * YEREL VARSAYILAN kalır: sağlayıcılar OPT-IN, her biri "veri şu sağlayıcıya
 * gider" etiketli. Katalog statik-gömülü → listeyi göstermek ağ istemez.
 */
export type ProviderAdapter = 'openai' | 'anthropic'

export interface ProviderInfo {
  id: string
  name: string
  /** OpenAI-uyumlu base (chat/completions için). Boş = kullanıcı girer (custom). */
  baseUrl: string
  adapter: ProviderAdapter
  /** API anahtarı ortam değişkeni ipucu (kullanıcıya gösterilir). */
  keyEnv?: string
  /** Yerel süreç mi (veri makineden çıkmaz)? */
  local?: boolean
  /** Birden çok modeli tek uçtan sunan gateway mi? */
  gateway?: boolean
  /** Anahtar API'sinin dokümanı. */
  docs?: string
}

/**
 * TAM katalog. `/models` çoğu OpenAI-uyumlu uçta çalışır → model listesi CANLI
 * çekilir (hardcode gerekmez). Yerel (ollama/lmstudio/llama.cpp) anahtar istemez.
 */
export const PROVIDERS: ProviderInfo[] = [
  // ── Birinci taraf frontier ────────────────────────────────────────────────
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', adapter: 'openai', keyEnv: 'OPENAI_API_KEY', docs: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', adapter: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', docs: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', adapter: 'openai', keyEnv: 'GEMINI_API_KEY', docs: 'https://aistudio.google.com/apikey' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', adapter: 'openai', keyEnv: 'XAI_API_KEY', docs: 'https://console.x.ai' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', adapter: 'openai', keyEnv: 'MISTRAL_API_KEY', docs: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', adapter: 'openai', keyEnv: 'DEEPSEEK_API_KEY', docs: 'https://platform.deepseek.com/api_keys' },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', adapter: 'openai', keyEnv: 'COHERE_API_KEY' },
  { id: 'ai21', name: 'AI21 Labs', baseUrl: 'https://api.ai21.com/studio/v1', adapter: 'openai', keyEnv: 'AI21_API_KEY' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', adapter: 'openai', keyEnv: 'PERPLEXITY_API_KEY' },
  { id: 'reka', name: 'Reka', baseUrl: 'https://api.reka.ai/v1', adapter: 'openai', keyEnv: 'REKA_API_KEY' },
  { id: 'upstage', name: 'Upstage (Solar)', baseUrl: 'https://api.upstage.ai/v1/solar', adapter: 'openai', keyEnv: 'UPSTAGE_API_KEY' },

  // ── Asya frontier ─────────────────────────────────────────────────────────
  { id: 'moonshot', name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.ai/v1', adapter: 'openai', keyEnv: 'MOONSHOT_API_KEY' },
  { id: 'zhipuai', name: 'Zhipu AI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', adapter: 'openai', keyEnv: 'ZHIPU_API_KEY' },
  { id: 'alibaba', name: 'Alibaba (Qwen/DashScope)', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', adapter: 'openai', keyEnv: 'DASHSCOPE_API_KEY' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', adapter: 'openai', keyEnv: 'MINIMAX_API_KEY' },
  { id: 'baichuan', name: 'Baichuan', baseUrl: 'https://api.baichuan-ai.com/v1', adapter: 'openai', keyEnv: 'BAICHUAN_API_KEY' },
  { id: 'stepfun', name: 'StepFun', baseUrl: 'https://api.stepfun.com/v1', adapter: 'openai', keyEnv: 'STEP_API_KEY' },
  { id: 'yi', name: '01.AI (Yi)', baseUrl: 'https://api.lingyiwanwu.com/v1', adapter: 'openai', keyEnv: 'YI_API_KEY' },
  { id: 'inception', name: 'Inception (Mercury)', baseUrl: 'https://api.inceptionlabs.ai/v1', adapter: 'openai', keyEnv: 'INCEPTION_API_KEY' },

  // ── Hızlı inference sağlayıcıları ─────────────────────────────────────────
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', adapter: 'openai', keyEnv: 'GROQ_API_KEY', docs: 'https://console.groq.com/keys' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', adapter: 'openai', keyEnv: 'CEREBRAS_API_KEY' },
  { id: 'sambanova', name: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', adapter: 'openai', keyEnv: 'SAMBANOVA_API_KEY' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', adapter: 'openai', keyEnv: 'TOGETHER_API_KEY' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', adapter: 'openai', keyEnv: 'FIREWORKS_API_KEY' },
  { id: 'deepinfra', name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', adapter: 'openai', keyEnv: 'DEEPINFRA_API_KEY' },
  { id: 'hyperbolic', name: 'Hyperbolic', baseUrl: 'https://api.hyperbolic.xyz/v1', adapter: 'openai', keyEnv: 'HYPERBOLIC_API_KEY' },
  { id: 'nebius', name: 'Nebius AI', baseUrl: 'https://api.studio.nebius.ai/v1', adapter: 'openai', keyEnv: 'NEBIUS_API_KEY' },
  { id: 'novita', name: 'Novita AI', baseUrl: 'https://api.novita.ai/v3/openai', adapter: 'openai', keyEnv: 'NOVITA_API_KEY' },
  { id: 'lambda', name: 'Lambda', baseUrl: 'https://api.lambda.ai/v1', adapter: 'openai', keyEnv: 'LAMBDA_API_KEY' },
  { id: 'baseten', name: 'Baseten', baseUrl: 'https://inference.baseten.co/v1', adapter: 'openai', keyEnv: 'BASETEN_API_KEY' },
  { id: 'inference-net', name: 'Inference.net', baseUrl: 'https://api.inference.net/v1', adapter: 'openai', keyEnv: 'INFERENCE_API_KEY' },
  { id: 'targon', name: 'Targon', baseUrl: 'https://api.targon.com/v1', adapter: 'openai', keyEnv: 'TARGON_API_KEY' },
  { id: 'chutes', name: 'Chutes', baseUrl: 'https://llm.chutes.ai/v1', adapter: 'openai', keyEnv: 'CHUTES_API_KEY' },
  { id: 'venice', name: 'Venice AI', baseUrl: 'https://api.venice.ai/api/v1', adapter: 'openai', keyEnv: 'VENICE_API_KEY' },
  { id: 'morph', name: 'Morph', baseUrl: 'https://api.morphllm.com/v1', adapter: 'openai', keyEnv: 'MORPH_API_KEY' },

  // ── Gateway'ler (uzun kuyruğu kapatır — tek anahtar, çok model) ────────────
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', adapter: 'openai', keyEnv: 'OPENROUTER_API_KEY', gateway: true, docs: 'https://openrouter.ai/keys' },
  { id: 'vercel', name: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1', adapter: 'openai', keyEnv: 'AI_GATEWAY_API_KEY', gateway: true },
  { id: 'requesty', name: 'Requesty', baseUrl: 'https://router.requesty.ai/v1', adapter: 'openai', keyEnv: 'REQUESTY_API_KEY', gateway: true },
  { id: 'fastrouter', name: 'FastRouter', baseUrl: 'https://go.fastrouter.ai/api/v1', adapter: 'openai', keyEnv: 'FASTROUTER_API_KEY', gateway: true },
  { id: 'crofai', name: 'CrofAI', baseUrl: 'https://ai.nahcrof.com/v2', adapter: 'openai', keyEnv: 'CROFAI_API_KEY', gateway: true },
  { id: 'litellm', name: 'LiteLLM (yerel proxy)', baseUrl: 'http://localhost:4000/v1', adapter: 'openai', keyEnv: 'LITELLM_API_KEY', gateway: true, local: true },
  { id: 'huggingface', name: 'Hugging Face (router)', baseUrl: 'https://router.huggingface.co/v1', adapter: 'openai', keyEnv: 'HF_TOKEN', gateway: true },
  { id: 'github-models', name: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', adapter: 'openai', keyEnv: 'GITHUB_TOKEN', gateway: true },
  { id: 'github-copilot', name: 'GitHub Copilot', baseUrl: 'https://api.githubcopilot.com', adapter: 'openai', keyEnv: 'GITHUB_TOKEN', gateway: true },
  { id: 'opencode', name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', adapter: 'openai', keyEnv: 'OPENCODE_API_KEY', gateway: true },

  // ── Bulut platformları (kurumsal) ─────────────────────────────────────────
  { id: 'azure', name: 'Azure OpenAI', baseUrl: '', adapter: 'openai', keyEnv: 'AZURE_API_KEY', docs: 'kaynak-adına-özel base URL girilir' },
  { id: 'bedrock', name: 'Amazon Bedrock', baseUrl: '', adapter: 'openai', keyEnv: 'AWS_BEARER_TOKEN_BEDROCK', docs: 'bölgeye-özel base URL' },
  { id: 'vertex', name: 'Google Vertex AI', baseUrl: '', adapter: 'openai', keyEnv: 'GOOGLE_APPLICATION_CREDENTIALS', docs: 'proje/bölgeye-özel base URL' },
  { id: 'databricks', name: 'Databricks', baseUrl: '', adapter: 'openai', keyEnv: 'DATABRICKS_TOKEN', docs: 'workspace-özel base URL' },
  { id: 'digitalocean', name: 'DigitalOcean (Gradient)', baseUrl: 'https://inference.do-ai.run/v1', adapter: 'openai', keyEnv: 'DIGITALOCEAN_TOKEN' },
  { id: 'scaleway', name: 'Scaleway', baseUrl: 'https://api.scaleway.ai/v1', adapter: 'openai', keyEnv: 'SCALEWAY_API_KEY' },
  { id: 'ovhcloud', name: 'OVHcloud', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', adapter: 'openai', keyEnv: 'OVH_API_KEY' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', baseUrl: '', adapter: 'openai', keyEnv: 'CLOUDFLARE_API_TOKEN', docs: 'account-id-özel base URL' },
  { id: 'vultr', name: 'Vultr Inference', baseUrl: 'https://api.vultrinference.com/v1', adapter: 'openai', keyEnv: 'VULTR_API_KEY' },

  // ── Yerel (veri makineden ÇIKMAZ — yerel-önce ruh) ────────────────────────
  { id: 'ollama', name: 'Ollama (yerel)', baseUrl: 'http://localhost:11434/v1', adapter: 'openai', local: true },
  { id: 'lmstudio', name: 'LM Studio (yerel)', baseUrl: 'http://localhost:1234/v1', adapter: 'openai', local: true },
  { id: 'llamacpp', name: 'llama.cpp server (yerel)', baseUrl: 'http://localhost:8080/v1', adapter: 'openai', local: true },
  { id: 'jan', name: 'Jan (yerel)', baseUrl: 'http://localhost:1337/v1', adapter: 'openai', local: true },
  { id: 'vllm', name: 'vLLM (yerel/self-host)', baseUrl: 'http://localhost:8000/v1', adapter: 'openai', local: true },

  // ── Özel (kullanıcı kendi OpenAI-uyumlu ucunu girer) ──────────────────────
  { id: 'custom', name: 'Özel (OpenAI-uyumlu)', baseUrl: '', adapter: 'openai', keyEnv: 'API_KEY' }
]

export function findProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Kısa "veri nereye gider" etiketi (yerel için özel). */
export function dataDestinationNote(p: ProviderInfo, lang: 'tr' | 'en' = 'tr'): string {
  if (p.local) return lang === 'tr' ? 'Yerel süreç — veri makineden çıkmaz' : 'Local process — data stays on the machine'
  return lang === 'tr' ? `Veri ${p.name} sunucularına gider` : `Data goes to ${p.name}`
}
