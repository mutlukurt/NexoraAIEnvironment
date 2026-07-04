# NexoraAI Roadmap

The plan for going from **1 to 10**: first make the engine faster on the same hardware, then make small models act like masters, then give the agent eyes, and finally widen the platform. Each item is checked off as it ships.

**Guiding principle** (same one that built this app): don't ask the model nicely — make failure impossible, verify everything deterministically, and hide model mistakes from the user.

---

## Phase 1 — The Engine (v0.10.x)

Speed and context wins that benefit every user, on the exact same models.

- [x] **1.1 Flash attention + KV cache quantization** — enable `flashAttention` and a quantized KV cache in the inference worker; roughly doubles the usable context window in the same RAM. Cheapest win first. *Shipped: the worker now tries flash attention + Q8_0 KV first (context tiers doubled) and falls back to the old F16 path per size on unsupported models/hardware. Verified live: a Qwen2.5-Coder-3B that previously got a 16k window now loads with its full 32k train context on the same 16 GB laptop.*
- [x] **1.2 Partial GPU offload** — a GPU-layer slider plus VRAM-aware auto-recommendation in the Hardware Advisor. Small VRAM cards (e.g. 4 GB RTX 2050) currently fall back to pure CPU; offloading half the layers can nearly double speed. *Shipped: the worker now offloads layers with a step-down ladder (requested/auto → 60% → 40% → 20% of the model's layers → CPU), because Vulkan's free-VRAM estimate is optimistic and even `auto` can OOM while loading weights. Settings gained a GPU-layer slider (0 = auto-fit to free VRAM) and the model card shows the real offload ("GPU 16/29"). Measured on the 4 GB RTX 2050 dev laptop with Qwen2.5-Coder-7B: 4.2 → 7.2 tok/s (+71%), context 16k → 32k.*
- [x] **1.3 Per-phase sampler presets** — plan/enhance = 0.7 temperature (creativity), code generation = 0.2, "düzelt" fix = 0.05–0.1 (surgeon's hand). Three-line change, measurable quality. *Shipped: the single `chat.send` site in the app store now derives sampling from the turn's phase flags — plan/enhance turns get 0.7/topP 0.95, code stays at 0.2, and every fix turn (including the automatic re-tries) runs at 0.1.*
- [x] **1.4 Context compaction with summary** — before the 75% reset, have the model write a 3-sentence summary and carry it into the fresh session, so "what the user accepted/rejected" survives compaction. *Shipped: when the window passes 75%, the worker first asks the still-alive session for a 3–5 sentence summary (never streamed to the UI, capped at 250 tokens, skipped when no headroom remains) and embeds it in the fresh session's compaction note; on any failure it falls back to the old summary-less note. Verified live: a planted fact ("Fırın Luna", purple theme) survived a real 12.5k/16k compaction and was recalled correctly afterwards.*
- [ ] **1.5 Migrate main inference to `llama-server`** — the app already ships llama.cpp's official server for vision. Moving chat inference to it unlocks prompt caching / KV reuse (iterations stop re-prefilling the whole project every turn — the single biggest latency cost on CPU), parallel slots (vision + code at once), and speculative decoding (0.5B draft + 7B main, 30–60% faster on code).

## Phase 2 — Making Small Models Masters (v0.11.x)

A small model's weakness isn't intelligence, it's freedom. The less freedom, the more mastery.

- [ ] **2.1 GBNF grammar-enforced edit blocks** — constrain output at the sampler level so the SEARCH/REPLACE format *cannot* be violated. Retires the streaming watchdog and corrective retries; the same philosophy as the CJK token ban.
- [ ] **2.2 Plan → file-by-file generation** — for big requests: approved plan, then one fresh-context prompt per file ("write only `Hero.tsx`; here are `data.ts`'s types"). Small models are consistent within one file — this generalizes that insight to multi-file projects, with per-file retry.
- [ ] **2.3 Auto-verify after every generation** — run the existing background build check after *every* generation (not just Run), silently auto-fix on failure, then announce "generated *and* compiled". The user never sees broken output.
- [ ] **2.4 Section template bank** — 10–15 hand-crafted, design-proven parametric section templates (Hero, Pricing, FAQ, Footer…). The model fills in content and theme instead of writing from scratch: 3B + good template beats 14B + blank page.
- [ ] **2.5 Model-family prompt profiles** — detect the family (Qwen/Gemma/Llama) from GGUF metadata and apply family-specific quirk fixes, the second axis next to size-adaptive prompting.

## Phase 3 — An Agent With Eyes (v0.12.x)

- [ ] **3.1 Import existing projects** — "Open folder" brings any real project into the workspace; smart context and surgical edits already work. Turns the app from a site generator into a local coding assistant for every React project.
- [ ] **3.2 Runtime error capture** — inject a tiny error hook into the dev-server page (`window.onerror` + console.error → local endpoint → chat), so "düzelt" covers runtime errors, not just compile errors.
- [ ] **3.3 Visual self-review** — after Run, screenshot the page and show it to the app's own vision model: empty sections? overflow? does it match the reference image? Auto-iterate if not. The app can already see — it just doesn't look at its own work yet.
- [ ] **3.4 Git-based generation history** — every accepted generation becomes a commit; unlimited timeline instead of the 20-step undo buffer.

## Phase 4 — Productization (v1.0)

- [ ] **4.1 Hybrid API mode** — optional OpenAI-compatible / Anthropic endpoint for weak hardware; local stays the default.
- [ ] **4.2 Windows & macOS packaging**
- [ ] **4.3 Multi-project workspaces + in-project search**
- [ ] **4.4 Remote model-catalog manifest** — update the Hardware Advisor's catalog without shipping a new app version.
- [ ] **4.5 Local mini-benchmark** — a 2-minute on-device eval (generate a section → compile → score) so the Advisor shows real quality scores measured on *your* machine, not just speed grades.
- [ ] **4.6 Local image generation** — stable-diffusion.cpp so generated sites get real, theme-matched images instead of placeholders.

---

**One-sentence summary:** move the engine to llama-server + grammar and auto-verify every generation, and today's 7B results will come from a 3B and 14B results from a 7B — that is what "making small models masters" means; add "open folder" and visual self-review on top, and the app graduates from a site builder to a local coding assistant.
