import type { NexoraApi } from '../preload'

declare module '*?raw' {
  const content: string
  export default content
}

declare module '*?raw' {
  const content: string
  export default content
}

declare global {
  interface Window {
    nexora: NexoraApi
  }
}

export {}
