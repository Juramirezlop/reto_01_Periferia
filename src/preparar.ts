import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { ejecutar } from "./agent/herramientas"
import { fechaEjecucion, rutaOutCaso, rutasBase, type Ctx } from "../modulo/tools/util"

// Arma los paquetes que falten o estén calculados con otra fecha
export async function prepararCasos(directory = process.cwd()): Promise<string[]> {
  const ctx: Ctx = { directory, sessionId: "arranque" }
  const entradas = await readdir(rutasBase(ctx).casos, { withFileTypes: true }).catch(() => [])
  const preparados: string[] = []

  for (const caso of entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const estado = await Bun.file(join(rutaOutCaso(ctx, caso), "estado.json")).json().catch(() => null)
    if (estado?.fecha === fechaEjecucion()) continue // ya está al día
    await ejecutar("proveedor_generar_formulario", { caso }, ctx, false)
    await ejecutar("proveedor_armar_paquete", { caso }, ctx, false)
    preparados.push(caso)
  }
  return preparados
}
