import { defineConfig } from "vite";

// Relative paths, so the build works from a sub-folder on GitHub Pages or from any static host.
export default defineConfig({ base: "./", build: { target: "es2022" } });
