/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORM_ENDPOINT?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
