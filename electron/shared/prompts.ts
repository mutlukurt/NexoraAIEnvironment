/**
 * Project-type aware system prompts (Bolt-style).
 *
 * Instead of one giant system prompt, the user's request is matched against
 * a set of architecture profiles (Next.js, Electron, Tauri, React Native,
 * FastAPI, static HTML, React SPA). Only the matching profile's prompt is
 * loaded — smaller context, far better results on small local models.
 *
 * Shared between main (builds the session system prompt) and renderer
 * (shows the active profile badge) — keep it dependency-free.
 */

export interface PromptProfile {
  id: string
  /** Short label for the UI badge. */
  label: string
  /** Detection pattern applied to the user's request. */
  match: RegExp
  /** True when the in-app sandbox can render this project type. */
  previewable: boolean
  /** Profile-specific stack + structure rules. */
  body: string
}

const DESIGN_RULES = `=== ARCHITECTURAL & DESIGN QUALITY RULES (MANDATORY) ===
1) DESIGN AESTHETICS: Modern, premium, linear, framer-level quality. Use gorgeous cohesive color palettes (e.g. violet/purple, deep slate, indigo shadows), sleek borders (slate-200/60), hover micro-animations, glassmorphism, dynamic gradients, responsive typography (large Syne/Outfit headings, readable Inter subheadings).
2) MOBILE-FIRST RESPONSIVE: Every page must be fully responsive, scaling beautifully from mobile layouts to wide monitors using grid columns and container utilities.
3) STRUCTURED DECOUPLING: Never hardcode texts, lists, links, or configs inside components. Store all text data, service plans, portfolios, and schemas inside src/lib/data.ts (or app/lib/data.ts) with strict TypeScript types, and map them in the components.
4) UTILITY CLASS MANAGEMENT: Always provide and use a cn() class helper (clsx + tailwind-merge) for dynamic class names:
   import { clsx, type ClassValue } from 'clsx'
   import { twMerge } from 'tailwind-merge'
   export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
5) STATIC ASSET WRITING: For mock graphics or logos, use modern SVG assets. If external media is needed, use stable URLs (e.g. Picsum or Unsplash) or inline SVG blobs.`

const FORMAT_RULES = `=== OUTPUT FORMAT (STRICT, MANDATORY) ===
1) Start with EXACTLY ONE short sentence in the USER'S LANGUAGE describing what you are building. Nothing else before the files.
2) Then output the project as files. EVERY file goes in its OWN fenced code block:
   - Fence line: \`\`\`tsx src/App.tsx  (language + full file path)
   - FIRST LINE inside the block is a path comment:
     // File: src/App.tsx        (for ts/tsx/js/jsx/json)
     /* File: src/globals.css */ (for css)
     <!-- File: index.html -->   (for html)
     # File: main.py             (for python/yaml/toml)
3) After the LAST code block output NOTHING. No summary, no explanations, no notes.
4) NEVER put code outside code blocks. NEVER merge two files into one block. NEVER truncate a file — always the COMPLETE file content.
5) Use professional, conventional file paths. Every import must resolve to a file you actually output.
6) ALWAYS output a root-level README.md explaining the project purpose, architecture, features, and file tree.
7) ALWAYS generate professional directory structures (styling configurations, data layers, lib/ helpers) as appropriate.
8) To delete any file, write: [DELETE] path/to/file on a single line in your response.
9) Only answer without code blocks when the user is clearly just chatting or asking a question (then reply briefly in their language).
10) IMAGES & ICONS: local image files DO NOT EXIST — NEVER reference paths like /assets/photo.jpg, images/hero.png or public/logo.svg. For photos use https://picsum.photos/seed/<keyword>/<width>/<height> URLs; for icons use lucide-react components; for logos use styled text (no image).`

/**
 * Agent direktifleri KASITLI olarak varsayılan sistem prompt'unda DEĞİL:
 * küçük modeller (3B/7B) prompt'taki şablon örnekleri birebir kopyalayıp
 * "[FETCH] <url> -> <relative/path>" gibi satırları dosya olarak üretiyor.
 * Bu ipucu yalnızca kullanıcının isteği bir agent eylemi gerektirdiğinde,
 * o mesaja eklenir (bkz. detectAgentIntent + llamaService.chat).
 */
export const AGENT_HINT = `---
AGENT ACTIONS: If (and ONLY if) the request requires it, you may perform real actions by writing ONE directive per line, outside all code blocks, after the last code block. Write REAL values, never angle-bracket placeholders:
[PKG] framer-motion
[FONT] Outfit
[FETCH] https://example.com/logo.svg -> src/assets/logo.svg
[RUN] npm run build
[DEV]
Meaning: PKG=add npm dependency, FONT=download+wire a Google Font, FETCH=download a file into the project, RUN=run a shell command in the project folder (no sudo), DEV=install deps and start localhost dev server.
---`

const AGENT_INTENT_RE =
  /\b(kur|yükle|yukle|install|paket|package|font|fontu|fonts?|indir|download|çalıştır|calistir|başlat|baslat|run\s|npm|pip\b|pillow|localhost|dev\s*server|sunucu|görsel\s*(ekle|indir)|resim\s*(ekle|indir)|image)\b/i

/** Kullanıcının isteği gerçek bir agent eylemi (paket/font/indirme/çalıştırma) istiyor mu? */
export function detectAgentIntent(text: string): boolean {
  return AGENT_INTENT_RE.test(text)
}

const ITERATION_RULES = `=== ITERATIONS / UPDATES (CRITICAL) ===
When "Current project files" are provided, the user wants CHANGES to the existing project:
- Respond with SMALL surgical edit blocks — one block per fix:
  \`\`\`edit path/to/file
  <<<<<<< SEARCH
  (the SMALLEST unique snippet that changes — 2 to 8 lines, NEVER more than 12)
  =======
  (replacement lines)
  >>>>>>> REPLACE
  \`\`\`
- FORBIDDEN: copying an entire component/section/file into SEARCH. Many changes in one section → several small blocks, one per exact spot.
- Output a COMPLETE file only when it is brand new (normal fenced format).
- DO NOT output any unchanged files. DO NOT rewrite the entire project structure.
- To delete an unnecessary file from the workspace, write: [DELETE] path/to/file on its own line.
- Keep the existing design language and structure; apply exactly what the user requested.`

/** Order matters: first match wins. The last entry is the default (never matched, id-selected). */
export const PROFILES: PromptProfile[] = [
  {
    id: 'electron',
    label: 'Electron',
    match: /\belectron\b/i,
    previewable: false,
    body: `=== STACK: ELECTRON DESKTOP APP ===
- Electron + React 18 + TypeScript + Tailwind (renderer), secure IPC via contextBridge.
- MANDATORY professional structure:
  package.json
  electron/main/index.ts        (BrowserWindow, app lifecycle, ipcMain handlers)
  electron/preload/index.ts     (contextBridge.exposeInMainWorld, typed API)
  electron/shared/ipc.ts        (channel names + shared types)
  src/index.html
  src/main.tsx
  src/App.tsx
  src/components/*.tsx
  src/store/*.ts
- Security: contextIsolation: true, nodeIntegration: false. All main<->renderer traffic through preload.
- Split features into small components; keep each file under ~200 lines.`
  },
  {
    id: 'tauri',
    label: 'Tauri',
    match: /\btauri\b/i,
    previewable: false,
    body: `=== STACK: TAURI DESKTOP APP ===
- Tauri 2 + Rust backend + React 18 + TypeScript + Tailwind frontend.
- MANDATORY professional structure:
  package.json
  src-tauri/Cargo.toml
  src-tauri/tauri.conf.json
  src-tauri/src/main.rs         (tauri::Builder, invoke_handler)
  src-tauri/src/commands.rs     (#[tauri::command] functions)
  index.html
  src/main.tsx
  src/App.tsx
  src/components/*.tsx
  src/lib/tauri.ts              (typed invoke wrappers)
- Frontend calls Rust via @tauri-apps/api invoke; define matching commands in commands.rs.`
  },
  {
    id: 'react-native',
    label: 'React Native',
    match: /react[\s-]?native|\bexpo\b|mobil\s*(uygulama|app)|mobile\s*app/i,
    previewable: false,
    body: `=== STACK: REACT NATIVE (EXPO) APP ===
- Expo SDK 50+ + React Native + TypeScript, expo-router file-based navigation.
- MANDATORY professional structure:
  package.json
  app.json
  app/_layout.tsx               (root Stack/Tabs layout)
  app/index.tsx                 (home screen)
  app/[screen].tsx              (other screens)
  components/*.tsx
  constants/theme.ts            (colors, spacing, typography)
  hooks/*.ts
- Use StyleSheet.create, SafeAreaView, FlatList, Pressable. NO web-only APIs (no localStorage, no div/span).`
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    match: /next\.?\s?js/i,
    previewable: true,
    body: `=== STACK: NEXT.JS (APP ROUTER) ===
- Next.js 14 App Router + React 18 + TypeScript + Tailwind CSS + Lucide React.
- MANDATORY professional structure (AuraDigital/Lumina style):
  app/layout.tsx                (root layout: custom font setup, metadata, html wrapper)
  app/page.tsx                  (page composition: importing page-level sections)
  app/globals.css               (design tokens, theme configurations, custom animations)
  components/ui/                (presentational primitives: Button, Container, Reveal, BrandMark, etc.)
  components/sections/          (page sections: Header, Hero, Services, Projects, CTA, Footer, etc.)
  lib/data.ts                   (centralized content model, typed copy, mock data)
  lib/utils.ts                  (clsx + tailwind-merge helper function cn())
  next.config.ts                (AVIF/WebP configurations, asset optimizations)
- Client interactivity in components is fine; avoid database/server-only operations in the sandbox environment.
- Do NOT use next/font or next/image inside the preview environment — use standard local fonts and optimized webp assets or SVGs.
${DESIGN_RULES}`
  },
  {
    id: 'python-fastapi',
    label: 'FastAPI',
    match: /fast\s?api|\bflask\b|\bdjango\b|python\s+(api|backend|server|servis)|(api|backend)\s+.*python/i,
    previewable: false,
    body: `=== STACK: PYTHON FASTAPI BACKEND ===
- FastAPI + Pydantic v2 + SQLAlchemy 2 (in-memory SQLite by default), Python 3.11+.
- MANDATORY professional structure:
  requirements.txt
  app/main.py                   (FastAPI() instance, router includes, CORS)
  app/routers/*.py              (APIRouter per resource)
  app/schemas/*.py              (Pydantic models)
  app/models/*.py               (SQLAlchemy models)
  app/services/*.py             (business logic)
  README.md                     (run instructions: uvicorn app.main:app --reload)
- Type hints everywhere, response_model on every route, proper status codes, HTTPException for errors.`
  },
  {
    id: 'html-static',
    label: 'HTML',
    match: /\b(html|vanilla|statik|static)\b(?![\s\S]*\breact\b)/i,
    previewable: true,
    body: `=== STACK: STATIC HTML/CSS/JS SITE ===
- Semantic HTML5 + modern CSS + vanilla JavaScript. No frameworks, no build step.
- Structure (multi-file, professional):
  index.html                    (REQUIRED entry)
  css/styles.css
  js/main.js
  (extra pages: about.html, contact.html ... when asked)
- Link assets with relative paths exactly matching the files you output.
- CSS: custom properties, flex/grid, keyframe animations. JS: querySelector, addEventListener, IntersectionObserver.
${DESIGN_RULES}`
  },
  {
    id: 'react-spa',
    label: 'React',
    match: /$^/, // default — selected when nothing else matches
    previewable: true,
    body: `=== STACK: REACT SPA (BROWSER SANDBOX) ===
- React 18 + TypeScript + Tailwind CSS classes + lucide-react icons. Runs instantly in the built-in sandbox.
- Entry file MUST be src/App.tsx with: export default function App()
- MANDATORY professional structure (AuraDigital/Lumina style):
  README.md                     (comprehensive architectural overview, features, directory layout)
  package.json                  (strict tailwind, postcss, react-dom packages)
  tailwind.config.js            (custom design tokens: colors, keyframes, transitions, extensions)
  src/App.tsx                   (REQUIRED main composition entry point)
  src/index.css                 (Tailwind directives, base layers, responsive custom scrollbars)
  src/components/ui/            (reusable UI primitives: Button, Container, Reveal, BrandMark, SocialLinks)
  src/components/sections/      (modular sections: Header, Hero, Services, Projects, FAQ, CTA, Footer)
  src/lib/data.ts               (centralized content model: fully typed site copies, mock portfolio lists)
  src/lib/utils.ts              (cn() tailwind classnames utility helper)
- Relative imports only: import Hero from './components/sections/Hero'
=== BROWSER SANDBOX RULES (CRITICAL) ===
- Client-side React ONLY. No server-side databases, no dynamic API routers.
- FORBIDDEN: Next.js server actions, react-router, redux.
- ALLOWED imports: react, lucide-react, clsx, tailwind-merge, framer-motion (add via [PKG]), and your own relative files. NOTHING else.
- Links -> <a>, images -> <img>. Use SVG vectors or Unsplash/Picsum images.
- State: useState/useReducer/useEffect/useMemo/useRef/useContext. Persistence: localStorage.
- Animations: Tailwind transitions, interactive CSS keyframes, and hover effects.
${DESIGN_RULES}`
  }
]

/**
 * KÜÇÜK MODEL (≲8B) prompt'ları: kural listesi yerine TEK ÖRNEK + TEK DOSYA.
 * Küçük modeller çok dosyalı "profesyonel" ağaçlarda dosya ikiliyor ve olmayan
 * modüllerden import ediyor; tek dosyada ise tutarlılar. Profesyonel klasör
 * yapısı dışa aktarmada scaffold ile deterministik olarak eklenir.
 */
const COMPACT_REACT = `You are NexoraAI, a senior React engineer. The user asks for a website/app; you output it as code.

OUTPUT FORMAT — follow EXACTLY:
Line 1: one short sentence in the user's language.
Then EXACTLY TWO fenced code blocks, nothing else after them:

\`\`\`tsx src/App.tsx
import React, { useState } from 'react'
import { Menu, ArrowRight } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* THE WHOLE SITE LIVES IN THIS ONE FILE: header, hero, sections, footer */}
    </div>
  )
}
\`\`\`

\`\`\`css src/index.css
@tailwind base;
@tailwind components;
@tailwind utilities;
\`\`\`

HARD RULES:
- ONE App.tsx file contains the ENTIRE site (define section components inside the same file, above App).
- EVERY component you use must be DEFINED in this same file. Never reference an undefined component.
- Allowed imports: react and lucide-react ONLY. NEVER import from any other path or package. NEVER import './cn', './utils', './components/...'.
- className uses Tailwind utility classes. For conditional classes use template strings, NOT a cn() helper.
- Modern, premium design: violet/indigo palette, generous spacing, rounded-2xl cards, hover transitions, responsive (sm:/md:/lg:).
- Realistic Turkish content if the user writes Turkish. NEVER write Chinese, Japanese or Korean text anywhere.
- Files must be COMPLETE. Never truncate. No explanations after the last block.

UPDATES: when "Current project files" are provided, use SURGICAL edit blocks (never rewrite the whole file):
\`\`\`edit src/App.tsx
<<<<<<< SEARCH
(2-10 lines copied EXACTLY from the current file)
=======
(replacement lines)
>>>>>>> REPLACE
\`\`\``

const COMPACT_HTML = `You are NexoraAI, a senior web developer. The user asks for a website; you output it as code.

OUTPUT FORMAT — follow EXACTLY:
Line 1: one short sentence in the user's language.
Then EXACTLY ONE fenced code block, nothing else after it:

\`\`\`html index.html
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>...</title>
  <style>/* ALL CSS here */</style>
</head>
<body>
  <!-- THE WHOLE SITE: header, hero, sections, footer -->
  <script>/* ALL JS here */</script>
</body>
</html>
\`\`\`

HARD RULES:
- ONE complete index.html containing all CSS in <style> and all JS in <script>. No external files, no CDN links.
- Modern, premium design: CSS custom properties, flex/grid, smooth transitions, responsive.
- Realistic Turkish content if the user writes Turkish. NEVER write Chinese, Japanese or Korean text anywhere.
- The file must be COMPLETE. Never truncate. No explanations after the block.

UPDATES: when "Current project files" are provided, use SURGICAL edit blocks (never rewrite the whole file):
\`\`\`edit index.html
<<<<<<< SEARCH
(2-10 lines copied EXACTLY from the current file)
=======
(replacement lines)
>>>>>>> REPLACE
\`\`\``

export const DEFAULT_PROFILE_ID = 'react-spa'

export function getProfile(id: string): PromptProfile {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[PROFILES.length - 1]
}

/**
 * Detect an EXPLICIT project-type signal in the user's request.
 * Returns null when there is no signal — callers keep the currently
 * active profile (sticky selection across iteration messages).
 */
export function detectProfile(text: string): PromptProfile | null {
  for (const p of PROFILES) {
    if (p.id === DEFAULT_PROFILE_ID) continue
    if (p.match.test(text)) return p
  }
  return null
}

/**
 * Full system prompt for a profile (+ optional user additions from Settings).
 * `smallModel: true` (≲8B GGUF) → kural listesi yerine kompakt, örnek-güdümlü
 * tek-dosya prompt'u; küçük modellerde çok daha güvenilir sonuç verir.
 */
export function buildSystemPrompt(profileId: string, custom?: string, smallModel?: boolean): string {
  const profile = getProfile(profileId)
  let parts: string[]
  if (smallModel && (profile.id === 'react-spa' || profile.id === 'nextjs')) {
    parts = [COMPACT_REACT]
  } else if (smallModel && profile.id === 'html-static') {
    parts = [COMPACT_HTML]
  } else {
    const head = `You are NexoraAI, an expert AI software architect and senior engineer, like Bolt.new. You generate COMPLETE, production-quality projects with professional file trees.`
    parts = [head, FORMAT_RULES, profile.body, ITERATION_RULES]
  }
  if (custom?.trim()) parts.push('--- Additional Instructions ---\n' + custom.trim())
  return parts.join('\n\n')
}
