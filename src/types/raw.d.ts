/**
 * Vite `?raw` imports — file contents bundled as strings at build time.
 * Used for the preview sandbox vendor scripts (react, tailwind, lucide).
 */
declare module '*?raw' {
  const src: string
  export default src
}
