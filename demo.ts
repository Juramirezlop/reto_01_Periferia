// Ejecuta TODAS las herramientas sobre todos los casos, sin modelo ni claves.
// Uso: bun run demo.ts
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import * as proveedor from "./src/tools/proveedor"
import type { Ctx } from "./src/tools/util"

// Fecha fija para que el resultado sea el mismo en cada ejecución (lo pide el PRD).
// `||=` también cubre el caso de FECHA_EJECUCION= vacía en .env.
// Para otra fecha en PowerShell:  $env:FECHA_EJECUCION="2026-10-10"; bun run demo.ts
process.env.FECHA_EJECUCION ||= "2026-09-03"

type Respuesta = { ok: boolean; data?: Record<string, unknown>; error?: string }
type Herramienta = { execute: (args: unknown, ctx: Ctx) => Promise<string> }

const ctx: Ctx = { directory: process.cwd(), sessionId: "demo" }

// Llama una herramienta por nombre y convierte su respuesta (string JSON) en objeto.
async function llamar(nombre: keyof typeof proveedor, args: unknown): Promise<Respuesta> {
  const herramienta: Herramienta = proveedor[nombre]
  return JSON.parse(await herramienta.execute(args, ctx)) as Respuesta
}

// out/ se limpia al inicio para que cada ejecución parta de cero.
await rm(join(ctx.directory, "out"), { recursive: true, force: true })
console.log(`Fecha de ejecución: ${process.env.FECHA_EJECUCION}`)

const casos = (await readdir(join(ctx.directory, "fixtures", "reto-01", "casos"), { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

for (const caso of casos) {
  console.log(`\n=== ${caso} ===`)

  const leida = await llamar("leer_solicitud", { caso })
  if (!leida.ok || !leida.data) {
    console.log(`  leer_solicitud falló: ${leida.error}`)
    continue // un caso malo no impide el siguiente
  }
  const campos = leida.data.campos as { etiqueta: string }[]
  console.log(`  Cliente: ${String(leida.data.cliente)} (${String(leida.data.pais)}) | formato: ${String(leida.data.formato)}`)

  const mapeo = await llamar("mapear_campos", { caso, campos: campos.map((c) => c.etiqueta) })
  const cuenta = (clave: string) => (mapeo.data?.[clave] as unknown[] | undefined)?.length ?? 0
  console.log(`  Campos: ${cuenta("llenos")} llenos, ${cuenta("faltantes")} faltantes, ${cuenta("requiere_confirmacion")} por confirmar`)

  const formulario = await llamar("generar_formulario", { caso })
  console.log(`  Formulario: ${formulario.ok ? String(formulario.data?.ruta) : formulario.error}`)

  const paquete = await llamar("armar_paquete", { caso })
  if (paquete.ok && paquete.data) {
    const checklist = paquete.data.checklist as { bloqueos: string[] }
    console.log(`  Paquete: ${String(paquete.data.ruta)} | listo_para_firma: ${String(paquete.data.listo_para_firma)}`)
    for (const b of checklist.bloqueos) console.log(`    - ${b}`)
  } else {
    console.log(`  Paquete: ${paquete.error}`)
  }

  const sinConfirmar = await llamar("simular_envio", { caso, confirmado: false })
  console.log(`  Envío sin confirmar: ${sinConfirmar.ok ? "ERROR: no debió permitirse" : `bloqueado ("${sinConfirmar.error}")`}`)
}

// Un envío con confirmación explícita (solo el primer caso, para mostrar el archivo simulado).
const primero = casos[0]
if (primero) {
  const envio = await llamar("simular_envio", { caso: primero, confirmado: true })
  console.log(`\nEnvío confirmado de ${primero}: ${envio.ok ? String(envio.data?.ruta) : envio.error}`)
}

// Casos de error (HU-5): ninguna herramienta lanza, todas devuelven { ok: false, error }.
console.log("\n=== Errores controlados ===")
console.log("  Caso inexistente:", (await llamar("leer_solicitud", { caso: "no-existe" })).error)
console.log("  Argumento inválido:", (await llamar("leer_solicitud", { caso: "../../etc" })).error)
