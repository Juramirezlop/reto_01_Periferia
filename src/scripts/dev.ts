// Un comando levanta backend (puerto 3000) y front (puerto 5173): bun run dev
export {} // convierte el archivo en módulo (permite await al nivel superior)
const procesos = [
  Bun.spawn(["bun", "run", "src/server.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bunx", "vite"], { stdout: "inherit", stderr: "inherit" }),
]
// Ctrl+C cierra los dos.
process.on("SIGINT", () => {
  procesos.forEach((p) => p.kill())
  process.exit(0)
})
await Promise.race(procesos.map((p) => p.exited))
procesos.forEach((p) => p.kill())
