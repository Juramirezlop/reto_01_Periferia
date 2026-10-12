import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// El front vive en web/. en desarrollo
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  build: { outDir: "dist", emptyOutDir: true },
})
