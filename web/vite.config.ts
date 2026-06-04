import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm(), react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { port: 5173 }
});
