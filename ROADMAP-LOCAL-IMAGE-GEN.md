# Phase 12 — Local Image Generation (offline, on-device)

> **Planned 2026-07-10.** Sourced from a 10-agent internet-research sweep. v0.18 shipped image generation on the **API**; this phase ships its **offline twin** so a laptop with no internet and no keys can still generate images — the last missing piece of the local-first mission. NexoraAI already runs local **LLMs** (node-llama-cpp) and local **vision input** (Qwen-VL). The one thing it can't do on-device is **generate** images. This closes it.

---

## TL;DR — the decision is made by the research

**Engine: [`leejet/stable-diffusion.cpp`](https://github.com/leejet/stable-diffusion.cpp) — the "llama.cpp of image generation."** Every one of the 7 successful research agents independently converged on it. It is the *same class of artifact* as the `llama-server` NexoraAI already vendors and spawns:

- Same **GGML** lineage; loads **GGUF-quantized** weights (q4_0/q5_0/q8_0 + k-quants) exactly like our LLM engine.
- Ships **`sd-server`**, an actively-maintained HTTP binary with an **OpenAI-compatible `POST /v1/images/generations`** (and `/v1/images/edits`) endpoint — *the same shape the v0.18 API image-gen client already calls.*
- Prebuilt **per-platform / per-backend** release zips: Windows CUDA/Vulkan/CPU, macOS arm64 Metal, Linux Vulkan/CPU — the exact backend matrix our `.exe`/`.deb`/`.dmg` CI needs.
- MIT-licensed binary (safe to bundle).

**The integration is ~80% infrastructure we already own.** Concretely: add a **third spawned server** (`sdService.ts`, a near-clone of `visionService.ts`), have the **Hardware Advisor** download an SD/Flux GGUF by free VRAM (exactly like it downloads coder GGUFs), and **reuse the shipped API image-gen client code** by pointing its base-URL at `http://127.0.0.1:<port>`. A hybrid **off / local / API** toggle drops in next to the existing engine selector.

**Unique positioning (precedent research):** LM Studio, Jan, Ollama, GPT4All do LLMs only; Draw Things, DiffusionBee, Fooocus, InvokeAI, ComfyUI do images only. **No mainstream app ships both first-class local LLM coding *and* local image generation in one installer.** NexoraAI would be the first.

---

## Model & VRAM tiers (what the Advisor recommends)

The Hardware Advisor already detects free VRAM/RAM and picks a GGUF by fit (🟢 fits / 🔵 spills). Add an **image** tier using these researched numbers:

| Tier | Model | Quant / size | VRAM floor | Speed | Notes |
| --- | --- | --- | --- | --- | --- |
| **Entry / CPU-OK** | **SD 1.5** | ~1.5–2.8 GB | any GPU **or** CPU | slow on CPU (~30 s), instant on GPU | tiny, universal; SD-Turbo/LCM = 1–4 steps |
| **Balanced** | **SDXL / SDXL-Turbo** | ~6–7 GB | 8 GB | ~2.5 s on RTX 3070 | best quality-per-VRAM on 8 GB cards |
| **Sweet spot** | **Flux.1 [schnell]** *(Apache-2.0, commercial-OK, 4-step)* | Q4_0 ~6.4 GB / Q2_K ~4 GB | **4–6 GB** with `--clip-on-cpu` | fast (4 steps) | needs companion files: `ae.safetensors` (VAE), `clip_l`, `t5xxl` |
| **Quality** | **Flux.1 [dev]** *(non-commercial)* / **SD3.5** | Q8_0 ~11 GB / Q4_K ~6.5 GB | 8–12 GB | slower | highest fidelity |

**Low-VRAM survival flags (validated in research):** `--clip-on-cpu` (offload the ~9.5 GB T5 text encoder to RAM), `--vae-tiling`, `--vae-on-cpu`, `--offload-to-cpu`, `--diffusion-fa` (Flash Attention). These let Flux run on a **4 GB RTX 2050** (the dev's own card) at reduced speed. On a 4 GB card the default recommendation is **SD 1.5 / SDXL-Turbo**; Flux-schnell-Q4 is offered as "🔵 spills to RAM, slower."

---

## Sub-phases (build order)

- [ ] **12.1 `sdService.ts` — spawn + health + lifecycle (the foundation).** New `electron/main/sdService.ts`, a near-clone of `visionService.ts`. **Reuse verbatim:** `downloadFile()` (streamed `.part` rename + %-to-chat), `BIN_ROOT`/`MODELS_DIR`, the `spawn(bin, [...], {env:{LD_LIBRARY_PATH:dirname(bin)}})` pattern, the stdout `listening` readiness scan, and the POSIX group-kill stop (from 7.6). Dedicated port **8092** (add it to `llamaServerEngine`'s `AVOID_PORTS`; vision owns 8091). Model stays warm across requests.
- [ ] **12.2 Binary acquisition — vendor + first-run backend download.** Fetch prebuilt `sd-server` from `github.com/leejet/stable-diffusion.cpp/releases/<TAG>/`. Ship the **small universal binary** in the installer (win-vulkan 37.6 MB / macOS-arm64-Metal 49 MB / linux-vulkan 44.7 MB, + CPU fallback) — mirror the CI `vendor/` per-job download. **Do NOT bundle CUDA** (362 MB + 563 MB cudart): download it on **first run only when the Advisor detects an NVIDIA GPU**, exactly like GGUF weights today. Backend-select ladder: Vulkan (NVIDIA/AMD/Intel) → CPU fallback; CUDA optional for max NVIDIA speed. *(Note: no Linux-CUDA and no x86-macOS prebuilds — Vulkan/CPU cover Linux, Metal covers macOS arm64.)*
- [ ] **12.3 Advisor: image-model tier + GGUF download.** Extend the Hardware Advisor catalog with the table above. Same download-by-free-VRAM logic that picks 3B vs 14B for LLMs now picks SD1.5 vs SDXL vs Flux-schnell-Q4 vs Flux-dev-Q8. **Flux needs a bundle** (diffusion model + `ae` VAE + `clip_l` + `t5xxl`) — the downloader fetches all companion files and auto-adds `--clip-on-cpu --vae-tiling` on ≤ 8 GB.
- [ ] **12.4 Wire the OpenAI endpoint — reuse the shipped client.** Point the **existing v0.18 image-gen code** (`apiEngine.generateImage`, the OpenAI-compatible `/images/generations` path) at `http://127.0.0.1:8092`. Because `sd-server` speaks the same shape, the in-chat **preview / fullscreen / download / add-to-assets**, aspect ratio, count, and negative prompt all work with **zero new UI**. This mirrors how 10.2's "serve engine" already speaks OpenAI locally.
- [ ] **12.5 Hybrid off / local / API toggle + model detection.** A third state next to the engine selector: image generation runs **local (sd-server)**, **API (cloud image model)**, or **off**. `isImageGenModel` already routes; add "is a local SD/Flux model loaded?" so a local image model is picked like a local LLM. Same trust-tier / opt-in framing ("stays on your machine").
- [ ] **12.6 Progress & cancel.** `sd-server`'s native async job API (`/sdcpp/v1/img_gen` → poll `/sdcpp/v1/jobs/{id}` → `/cancel`) gives **step progress + partial-image preview** (`--preview tae`, `--preview-interval`) — stream it into the chat like token streaming. Wire Stop to job-cancel.
- [ ] **12.7 Advanced features (incremental, mostly native flags).** img2img (`--strength` + the existing attach-image UI → `/v1/images/edits`), **inpaint** (`--mask`), **LoRA** (`--lora-model-dir`, `<lora:name:weight>` in prompt), **ControlNet** (`--control-net`, canny/depth for SD1.5), **upscale** (ESRGAN/`--upscale-model`), samplers (`euler_a` default, `dpm++2m`, `lcm`), CFG/seed/steps. Each is a parameter, exposed in the existing `ImageOptions` popover.

---

## Integration architecture (concrete)

```
electron/main/sdService.ts        ← clone of visionService.ts (spawn sd-server, port 8092)
  ├─ ensureSdBinary()             ← clone binaryUrl()/ensureBinary() from llamaServerEngine, swap base URL
  ├─ ensureSdModel(advisorPick)   ← Advisor-driven GGUF + Flux companion download (reuse downloadFile)
  ├─ startSdServer()              ← spawn(sdBin, ['--diffusion-model', m, '--vae', ae, '--llm'|'--t5xxl', ..,
  │                                        '--diffusion-fa', '--offload-to-cpu', '--listen-port','8092','-v'])
  └─ stopSdServer()               ← POSIX group-kill (reuse 7.6)

electron/main/apiEngine.ts        ← generateImage() already speaks /v1/images/generations →
                                     point base-URL at 127.0.0.1:8092 for the local path (ZERO new client)

Hardware Advisor                  ← + image-model tier (SD1.5 / SDXL / Flux-schnell-Q4 / Flux-dev-Q8) by free VRAM
Settings / composer               ← off | local | API image-gen toggle (reuse existing ImageOptions UI)
CI build.yml                      ← each job also downloads the matching sd.cpp release zip into vendor/sd-bin
```

**Reuse ledger (what we do NOT rewrite):** the whole in-chat image UI (preview/fullscreen/download/add-to-assets, aspect/count/negative — all shipped in v0.18), the OpenAI image request/response client (`apiEngine`), the spawned-C++-server + health-scan + group-kill pattern (`visionService`/`llamaServerEngine`), the streamed GGUF downloader with %-progress, the Hardware Advisor VRAM detection + fit badges, the trust-tier/opt-in framing, and the per-platform CI vendor-download step.

---

## Licensing & distribution (from research — the 3 gated agents' topic, filled from the others)

- **`sd-server` binary:** MIT — safe to bundle/redistribute.
- **Models:** SD 1.5 / 2 → CreativeML OpenRAIL-M; SDXL → SDXL license; SD3.5 → Stability AI Community License; **Flux.1 [schnell] → Apache-2.0 (fully commercial)**; **Flux.1 [dev] → non-commercial** (label it clearly, don't imply commercial use). Most weights are auto-downloadable from Hugging Face; **some repos are gated** and need an HF token / click-through — for those, prompt the user to accept + paste a token (like a BYO-key), never auto-fetch silently. Default recommendation leans on the **Apache-2.0 Flux-schnell + OpenRAIL SD1.5** so out-of-the-box use is unencumbered.
- **Safety:** local SD has no built-in filter; add an opt-in note. Keep it clearly user-initiated.

---

## Sequencing & success test

**Order:** 12.1 spawn/lifecycle → 12.2 binary vendor → 12.3 Advisor model download → **12.4 wire OpenAI endpoint (this is the "it works" milestone — reuses all v0.18 UI)** → 12.5 hybrid toggle → 12.6 progress/cancel → 12.7 advanced features (as demand dictates).

**PASS when:** on a machine with **no internet after setup and no API key**, selecting a local image model and typing *"a red panda coding at a desk"* produces an image **inline in the chat** (preview/fullscreen/download/add-to-assets all working), generated by a spawned `sd-server` on `127.0.0.1`, with the model chosen by the Hardware Advisor for the detected VRAM — and **nothing left the machine**. Live-tested on the real app (incl. the dev's 4 GB RTX 2050 → SD1.5/SDXL-Turbo path), `test:engine` green, a new `test:imagelocal` locking the model-detection + endpoint routing.

**Explicitly reused, not reinvented:** this is the offline mirror of the shipped API image gen — same in-chat experience, engine swapped for a local spawned binary. That symmetry is the whole point.

---

## Sources (from the research agents)

- `github.com/leejet/stable-diffusion.cpp` — engine, `sd-server`, CLI flags, prebuilt releases (tag `master-769-cc73429`, 2026-07-08), OpenAI/A1111/native endpoints.
- stable-diffusion.cpp Flux docs — GGUF quant sizes, `--clip-on-cpu` 4–6 GB VRAM guidance.
- `huggingface.co/city96` & `leejet` — Flux/SD GGUF quantizations.
- black-forest-labs — Flux.1 [schnell] Apache-2.0 vs [dev] non-commercial.
- Precedent sweep — LM Studio (added diffusion mode), Jan (image understanding), Draw Things, DiffusionBee, Fooocus, InvokeAI, ComfyUI Desktop, Amuse: the "both LLM + image in one app" gap.

*(3 of 10 research agents — models catalog, hardware-tier deep-dive, licensing deep-dive — hit the structured-output retry cap and returned no report; their topics were reconstructed from the 7 that succeeded, which covered the same ground. Re-run those 3 for even finer model/VRAM/license tables before implementation if desired.)*
