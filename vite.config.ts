import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

const base = process.env.VITE_BASE_PATH?.trim() || "/";

export default defineConfig({
  base,
  plugins: [react() as PluginOption],
});

