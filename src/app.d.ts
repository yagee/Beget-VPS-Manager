// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  interface ImportMetaEnv {
    readonly PUBLIC_BEGET_API_BASE_URL?: string;
    readonly PUBLIC_BEGET_AUTH_X_TOKEN?: string;
  }
}

export {};
