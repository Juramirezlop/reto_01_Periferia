// Levanta backend (3000) y front (5173) con un solo comando: bun run dev
export {} // hace del archivo un módulo (permite await arriba)
const procesos = [
  Bun.spawn(["bun", "run", "src/server.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" }),
]
// Ctrl+C cierra ambos.
process.on("SIGINT", () => {
  procesos.forEach((p) => p.kill())
  process.exit(0)
})
await Promise.race(procesos.map((p) => p.exited))
procesos.forEach((p) => p.kill())
