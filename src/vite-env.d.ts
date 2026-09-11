/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The PWA origin card links resolve against. Plaza runs on its OWN origin,
   * so an App's `/a/<slug>` is NOT resolvable there: links are built absolute
   * against this origin. Unset in dev, where the fallback is the serving
   * origin itself.
   */
  readonly VITE_PWA_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
