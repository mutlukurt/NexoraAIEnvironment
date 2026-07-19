# Phase 13 — Local Image Generation (offline, on-device) — Detailed Spec (→ v0.19)

> **Historical document.** This file records plans and implementation claims from an
> earlier development stage. See [ROADMAP-2026.md](ROADMAP-2026.md) and
> [docs/CURRENT-TRUTH.md](docs/CURRENT-TRUTH.md); current source and evidence win.

> Redesigned **2026-07-10** from a **12-agent research + adversarial-verification** sweep (10 research dimensions → lead-architect synthesis → adversarial reviewer). The reviewer **proved the core end-to-end on the real 4 GB RTX 2050**: `sd-server` spawned, internet off, no API key → a real **457 KB PNG in ~33 s**. This spec folds every blocker the reviewer found back into the plan. Source tree is `/home/mutlu/Masaüstü/NexoraAI/` (the app's runtime data dir is `~/NexoraAI/`).

---

## 1. Engine decision — MADE

**PRIMARY: `leejet/stable-diffusion.cpp` `sd-server`** (pinned `SD_BIN_TAG=master-769-cc73429`).

Why it wins:
- **Diffusion sibling of llama.cpp** — GGML/GGUF lineage, spawnable HTTP server, per-OS prebuilt zips → maps onto our existing `binaryCandidates()` / spawn-ladder / vendored-binary pattern.
- **Out-of-process by construction** — all weights live in the spawned binary, so the **>4 GB Electron-V8-heap crash rule is satisfied automatically** (same as the 8091 vision sidecar).
- **`POST /v1/images/generations` → `{data:[{b64_json}]}`** is the byte-for-byte shape `generateImageOpenAI()` (apiEngine.ts) already POSTs → point base URL at `127.0.0.1:8092`, reuse the entire shipped in-chat UX with near-zero new client code.
- **MIT binary, no Python, no Node/N-API.** Verified: `sd-server` (2.04 MB) + `sd-cli` ship **inside the zip** alongside 34 `.so` files (the "no server binary" GitHub-API summary was wrong).

**FALLBACK:** the **CPU rung of the same binary** on a GPU→CPU spawn ladder — *not* a different engine.

**Rejected:** ComfyUI / A1111 / Fooocus (bundled Python, ~2× installer), onnxruntime-node (no GPU EP, no server, in-process → heap risk), candle/mistral.rs (no prebuilt server, Rust CI), Draw Things / WebGPU-MLC (single-OS / broken in Electron-Windows).

**Binary sizes (this tag):** Linux Vulkan 42.7 MB · Win Vulkan 35.9 MB · macOS Metal 46.9 MB · CPU 22–31 MB · CUDA 345 MB (+537 MB cudart) → **bundle Vulkan/Metal/CPU (~+40 MB/platform); download CUDA on demand only.**

---

## 2. Model tiers — one binary, quality = a different GGUF gated by the Advisor

| Tier | Model | Files / total disk | VRAM @512² | Steps | Measured / est. speed | License | 4 GB |
|---|---|---|---|---|---|---|---|
| **v1 — SHIP FIRST** | **SD 1.5 Q4_0** (VAE baked in) | 1 / **1.57 GB** | ~1.5 GB (loads to 1496 MB) | 20 | **~33 s** RTX 2050 Vulkan / minutes CPU | OpenRAIL-M (commercial OK) | 🟢 fits |
| v1 fast | SD 1.5 + LCM / Hyper-SD15 LoRA | 1 (+MB) / 1.57 GB | ~1.5 GB | 2–4 | ~7–10 s GPU (est.) | OpenRAIL-M | 🟢 fits |
| mid (opt-in only) | SDXL-Turbo | 1 / ~5 GB | ~8 GB | 1–4 | ~2.5 s (3070) | **Non-Commercial** | 🔵 spills |
| **high (clean license)** | **Flux.1-schnell Q4_0** | **4 / ~16 GB total** | ~7–8 GB | 4 | ~10 s+ (8 GB) | **Apache-2.0** | 🔵 spills |
| high (scale) | Z-Image-Turbo | 3 / Q4_0 + ~2.5 GB enc | 4 GB via offload | 8 | ~2–3 s (4090) | Apache-2.0 | 🔵 spills |

- **Ship/download FIRST: SD 1.5 GGUF Q4_0 (1.57 GB, `second-state/stable-diffusion-v1-5-GGUF`)** — single file, VAE baked in, fits 4 GB, runs on CPU, commercial-safe, non-corrupt output (channel variance ~5000, not #1220 gray).
- Flux is a **4-file bundle** (diffusion + `ae` VAE + `clip_l` + `t5xxl_fp16`) ≈ **16 GB total**, not the 6.77 GB diffusion file alone — the Advisor must show the **total**.
- **Never default/bundle** SDXL-Turbo/SD-Turbo (`sai-nc-community`, NC), SD3.5 ($1M gate), Flux-dev (NC) — opt-in with terms shown.
- The bf16-black-image bug is repo-specific (kostakoff); `second-state` ships only Q4_0…f16/f32 → non-issue for the chosen file.

---

## 3. Integration architecture

**New `electron/main/localImageService.ts` = a *corrected* clone of `visionService.ts`:**
- `IMAGE_PORT = 8092`; add `8092` to `AVOID_PORTS` in `llamaServerEngine.ts` (8091 is vision).
- Reuse verbatim: `downloadFile()` (%-to-chat + `.part`), stdout readiness scan `/listening|HTTP server/i` (sd-server prints `listening on: http://127.0.0.1:8092` ~4 s after model load; **no `/health`**), `spawn(...{env:{LD_LIBRARY_PATH:dirname(bin)}})`, POSIX group-kill.
- `pickImageModel` / `scanInstalledImageModels` (regex `sd|sdxl|flux|z-image`, exclude `mmproj`).
- **Exports:** `ensureLocalImageReady` (resolves a model path **before** spawn), `startImageServer(modelPath)`, `stopImageServer`, `hasLocalImageModel`, `generateImageLocal(prompt,opts):Promise<GenImg[]>`.

**Routing — insert at the VERY TOP of `generateImage()` (apiEngine.ts), before `active()`** (which throws `'Aktif bir görsel modeli yok.'` when there's no cloud image model):
```ts
if (localImageService.hasLocalImageModel())
  return localImageService.generateImageLocal(prompt, opts)   // POSTs to 127.0.0.1:8092
```
Add a distinct `activeLocalImageModel` flag; **widen the renderer `isImageGenModel` gate** (appStore.ts) so a local model enters the image path. Everything downstream is untouched: the `IMAGE_GENERATE` handler (index.ts) already decodes `b64`→`~/NexoraAI/cache/generated` + builds `data:` URLs; the renderer already does preview/fullscreen/download(`IMAGE_SAVE_AS`)/add-to-assets; `ImageGenOptions` already carries aspect/count/negativePrompt/promptExtend/referenceImageDataUrl.

---

## 4. BLOCKERS the adversarial pass caught (fold in BEFORE building)

- **B1 — sd-server needs `-m` at launch; it exits without a model.** `./sd-server` with no `-m` → `error: the following arguments are required: model_path/diffusion_model` and quits. The server is **bound to ONE model at launch** (unlike the vision sidecar's start-then-load). ⇒ `ensureLocalImageReady()` must resolve/download the model **before** spawn; treat the process as **per-model** (restart to switch model or change baked params). Kill the "spawn then ready" mental model.
- **B2 — the reused OpenAI endpoint gives ZERO per-request steps/seed/sampler/CFG.** It accepts only `prompt / n / size / output_format / output_compression`; steps/seed/sampler/cfg are **launch-time CLI flags** (returned PNG metadata showed `Steps:20, CFG:7.0, Seed:42` baked in). ⇒ ship seed+steps via the native `/sdcpp/v1/img_gen` body OR the `<sd_cpp_extra_args>{"sample_params":{"sample_steps":4}}</sd_cpp_extra_args>` prompt-embedded hack — **pulled forward to 12.3**, not deferred, because seed is the highest-value knob for the iterate-loop.
- **B3 — the sd.cpp zip is FLAT** (binaries + `.so`s at root, no top folder); vision's `serverBinaryPath()` builds a **nested** `join(BIN_ROOT,'sd-'+TAG,name)` → `existsSync()` fails. ⇒ write an explicit **flat** `sdServerPath()` (binary directly in `extractDir`), set `LD_LIBRARY_PATH` to that dir, `chmod +x` after extract. Use `unzip`/`tar -xf` (zip on **all** platforms), not `tar xzf`.

## 5. HIGH-severity corrections
- **H1 — speed is ~7× slower than the research estimate:** SD1.5 512²/20 steps = **~33 s** on the RTX 2050 (not "3–5 s"); LCM@4 steps ≈ 7–10 s; CPU = minutes. ⇒ **spinner+elapsed from the FIRST request** (12.2), not deferred to progress work.
- **H2 — cited flags are deprecated:** `--clip-on-cpu` / `--vae-on-cpu` are deprecated → use `--backend te=cpu` / `vae=cpu`, `--offload-to-cpu`, `--max-vram -1` (neg = auto-detect free VRAM), `--diffusion-fa`, `--vae-conv-direct`. Rewrite the 4 GB spawn ladder on these.
- **H3 — LLM↔SD VRAM concurrency is the real 4 GB killer:** SD alone loads ~1496 MB; a 14B coder + SD cannot co-reside on 4 GB. ⇒ explicit **mutex/handoff in 12.4** (pause/offload the LLM around an image gen, or run SD on CPU while GPU serves the LLM). An `[IMG]` mid-build would otherwise OOM one server.
- **H4 — `generateImage` routing must short-circuit before `active()`** (which throws with no cloud image model) and the renderer `isImageGenModel` gate must be widened, else a local model never enters the image path.

## 6. MEDIUM
- **M1 — licensing is a build task:** OpenRAIL-M is **pass-through** → surface license + Attachment-A use-restrictions on first SD1.5 download (modal + ToS). Mark SDXL-Turbo/SD-Turbo NC, opt-in, **never Advisor-default**. Advisor shows **total** Flux size (~16 GB).
- **M2 — `[IMG]` decode is NOT free reuse:** the decode-to-disk lives in the `IMAGE_GENERATE` handler + `IMAGE_SAVE_AS` (main), not in `executeDirectives` (renderer). `[IMG]` must explicitly call `IMAGE_GENERATE` then write bytes to `src/assets/` via the artifacts store + post-directive rescan.
- **M3 — unsigned fetched binary doubles AV/Gatekeeper surface** (llama.cpp Defender-Wacatac precedent) → **bundle the default Vulkan/Metal binary in app resources** (not curl-at-first-run); ship checksums + a Defender note; CUDA on-demand only.

---

## 7. Sub-phases (final order)

- **12.1 Model-first spawn** — `ensureLocalImageReady()` → `startImageServer(modelPath)` spawns `sd-server -m <sd15> --listen-ip 127.0.0.1 --listen-port 8092 -v`; 8092→`AVOID_PORTS`; explicit flat-zip path; `chmod +x`. *Accept:* internet OFF, `curl` returns `b64_json`. *Files:* `localImageService.ts` (new), `llamaServerEngine.ts`.
- **12.2 🎯 FIRST MILESTONE — real PNG in chat, offline** — local branch atop `generateImage()` + widen `isImageGenModel` + `activeLocalImageModel`; spinner+elapsed. *Accept:* internet OFF + no API key → "a red panda coding" → inline PNG via shipped UX; add-to-assets writes `src/assets/`. *Files:* `apiEngine.ts`, `appStore.ts`, `imageModels.ts`.
- **12.3 Per-request control** — seed/steps/sampler/cfg via native `/sdcpp/v1/img_gen` or `<sd_cpp_extra_args>`. *Files:* `localImageService.ts`, `imageModels.ts`.
- **12.4 LLM↔SD VRAM handoff** — mutex/offload. *Files:* `llamaServerEngine.ts`, `localImageService.ts`.
- **12.5 CI vendoring + bundle** — `vendor/sd-bin` per job; bundle Vulkan/Metal in resources; CUDA on-demand. *Files:* `build.yml`, `localImageService.ts`.
- **12.6 Model download + first-run + Advisor tier** — SD1.5 Q4_0 auto-download %/cancel + SHA-256 pin + `.ckpt/.pt` refusal; Advisor image tier (total size); off/local/API toggle. *Files:* `localImageService.ts`, `advisor.ts`, settings store + UI.
- **12.7 Correctness validator** — reject #1220 gray (channel-variance >50 = good) + stderr `ErrorOutOfDeviceMemory`; never trust exit code; auto-retry lower-res/more-offload. *Files:* `localImageService.ts`.
- **12.8 `[IMG]` directive** — `[IMG] … -> src/assets/logo.png [--seed … --ar 1:1]` → `IMAGE_GENERATE` → write `src/assets/`; trust-gated; rescan; deterministic seeds (same-machine). *Files:* `agentActions.ts`, `prompts.ts`, `appStore.ts`.
- **12.9 Current-flag spawn ladder + advanced** — `--backend`/`--max-vram -1`/`--offload-to-cpu`/`--diffusion-fa`/`--vae-conv-direct`; TAESD live preview; img2img strength/LoRA/upscale. *Files:* `localImageService.ts`, `imageModels.ts`.
- **12.10 `test:imagelocal` + live verify** — lock URL/routing/flat-path/scan/badges; `test:engine` green; real offline PNG on 4 GB. *Files:* `tests/`, `package.json`.

---

## 8. First milestone to build & test in a loop

Ship **12.1 + 12.2 as one loop**: (1) hand-drop `sd15-q4_0.gguf` into `~/NexoraAI/models/`; (2) clone `visionService.ts`→`localImageService.ts` with the **flat-zip path fix**, spawn `sd-server -m <sd15> --listen-ip 127.0.0.1 --listen-port 8092 -v`, scan stdout, add 8092 to `AVOID_PORTS`; (3) `hasLocalImageModel()` branch atop `generateImage()`, `generateImageLocal()` POSTs to `127.0.0.1:8092/v1/images/generations`; (4) widen `isImageGenModel`. **PASS = internet OFF + no API key → "a red panda coding" → inline PNG in chat via existing preview/fullscreen/download/add-to-assets, real binary in `src/assets/`.** Then loop: see PNG → tweak → regenerate → continue, on the 4 GB RTX 2050 (Vulkan) with CPU fallback.

**File-touch map (absolute):** `electron/main/localImageService.ts` (new) · `electron/main/apiEngine.ts` · `electron/main/visionService.ts` (clone source — fix flat path) · `electron/main/llamaServerEngine.ts` · `electron/main/index.ts` · `electron/shared/imageModels.ts` · `electron/shared/advisor.ts` · `src/lib/agentActions.ts` · `electron/shared/prompts.ts` · `src/store/appStore.ts` · `.github/workflows/build.yml`.

---

## 9. Hardware & Advisor — recovered dimension (verified/triangulated numbers)

*(This is the 10th research dimension, re-run after it errored; it refines the tiers above.)*

**v1 proof, refined — use a TURBO/low-step model for a "seconds" experience, not SD1.5 @20 steps (~33 s):**
- Ship-first proven-to-work base = **SD 1.5 Q4_0** (33 s @20 steps, verified). But for the *loop* UX, launch with **1–4 steps + Euler + CFG≈1.0** (SD-Turbo checkpoint, or SD1.5 with low steps) → **seconds** on the 4 GB card AND on CPU (1-step turbo ≈ 1.7–7.8 s CPU with TAESD). Steps/sampler/CFG are **launch flags** (per B2), so a fixed fast preset is set at spawn.
- **Default `--diffusion-fa` (flash attention) everywhere** — frees ~600 MB (Flux 768²) to ~1400 MB (SD2 768²), *no quality loss*, also faster.

**Vulkan caveat (the dev box is Vulkan):** sd.cpp's Vulkan backend is functional but **notably slower than CUDA**, occasionally pathological (issue #1114: ~100 s/iter Vulkan vs ~60 s CPU; FLUX.2-klein 25 s sd.cpp/Vulkan vs 5 s ComfyUI). ⇒ **ship a CUDA build for NVIDIA when we can** (download-on-demand, like the 924 MB CUDA note); on Vulkan keep to SD1.5/Turbo and expect single-digit-to-teens seconds, not sub-second.

**Advisor image tiers (mirror the LLM 🟢 fits / 🔵 spills), gate Flux on RAM too:**

| Detected VRAM | 🟢 default | 🔵 stretch | note |
|---|---|---|---|
| CPU-only | SD-Turbo/LCM 512² 1–4 steps + TAESD | SD1.5 20-step | seconds (turbo) / minutes (full) |
| < 4 GB | SD1.5 / SD-Turbo 512² | Flux-schnell q2_k (`te=cpu`, **RAM ≥ 16 GB**) | |
| **4–6 GB (RTX 2050)** | **SD1.5 GPU 512²** | Flux-schnell q2_k/q3_k (`te=cpu`) | SD1.5 6–15 s; Flux q2_k 1–3 min |
| 8 GB | SDXL-Turbo / Flux-schnell **q4_k** (`--lowvram`) | Flux-dev q4_k | Flux-schnell 40–90 s |
| 12 GB | Flux **q5_k/q8_0** | Flux-dev q8_0 | 55–90 s |
| 16 GB+ | Flux **q8_0 / dev** | Flux.2 | 30–65 s |

- **Gate Flux on system RAM, not just VRAM** — CPU-offload of the T5 encoder (~3–5 GB) + weights needs **16–32 GB RAM**; a 4 GB GPU with 8 GB RAM must **not** be offered Flux. This is the one extra input vs the LLM advisor.
- **Quant rule:** quantize *big* models to fit (Flux q2_k/q3_k are genuinely usable — large DiTs tolerate it), run *small* models at high precision (never q2_k an SD1.5 — it already fits 4 GB at fp16/q8). Q4_K is the mainstream quality floor; Q8_0 only at 12 GB+.
- **Flag naming:** the critique verified against the live `--help` that `--clip-on-cpu`/`--vae-on-cpu` are **deprecated** → use `--backend te=cpu` / `vae=cpu`, plus `--offload-to-cpu`, `--max-vram -1` (neg = auto-detect), `--vae-tiling`, `--vae-conv-direct`.

**Latency hiding:** load times NVMe ~3–8 s (SD1.5) → ~10–20 s (Flux+T5); spinning disk 30–40 s; warm mmap ~1.1 s. ⇒ (1) **keep `sd-server` resident** across requests (load once) + **idle-TTL** to release a 12 GB model; (2) **warm up on model-select**, not first prompt; (3) **`--taesd` latent preview** → blurry per-step preview so the wait feels alive (pairs with 4-step turbo = 4 frames); (4) real per-step progress counter is mandatory at Flux's 1–3 min on 4 GB.
