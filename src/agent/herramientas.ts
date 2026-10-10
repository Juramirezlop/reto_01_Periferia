import { z } from "zod"
import type { DeclaracionHerramienta } from "../llm/adapter"
import * as proveedor from "../tools/proveedor"
import type { Ctx } from "../tools/util"

type Herramienta = { description: string; args: z.ZodRawShape; execute: (args: unknown, ctx: Ctx) => Promise<string> }

// Cada export de proveedor.ts es una herramienta: proveedor_<export>.
const registro = new Map<string, Herramienta>(
  Object.entries(proveedor).map(([nombre, h]) => [`proveedor_${nombre}`, h as Herramienta]),
)

// Lo que ve el modelo: nombre, descripción y esquema de argumentos (generado desde zod).
export function declaraciones(): DeclaracionHerramienta[] {
  return [...registro.entries()].map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    parametros: z.toJSONSchema(z.object(h.args)) as Record<string, unknown>,
  }))
}

// Ejecuta una herramienta pedida por el modelo. Nunca lanza.
// `usuarioConfirmo` decide el valor de `confirmado`: el modelo NO puede confirmar por su cuenta.
export async function ejecutar(nombre: string, args: unknown, ctx: Ctx, usuarioConfirmo: boolean): Promise<string> {
  const herramienta = registro.get(nombre)
  if (!herramienta) return JSON.stringify({ ok: false, error: `La herramienta "${nombre}" no existe.` })
  if (nombre === "proveedor_simular_envio" && typeof args === "object" && args !== null) {
    args = { ...args, confirmado: usuarioConfirmo }
  }
  return herramienta.execute(args, ctx)
}
