/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORM_ENDPOINT?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
  readonly VITE_ENABLE_PILOT_APP?: string;
  readonly VITE_FLOWTALLY_API_BASE_URL?: string;
  readonly VITE_PILOT_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
