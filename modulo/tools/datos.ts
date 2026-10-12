import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type Ctx, ErrorHerramienta, leerJson, rutasBase } from "./util"

// ---------- Esquemas: cómo DEBE verse cada archivo de los fixtures ----------

// Nombre de caso: minúsculas, números y guiones (evita rutas como ../../etc).
export const nombreCaso = z
  .string()
  .regex(/^[a-z0-9-]+$/, "solo minúsculas, números y guiones")
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, por ejemplo ec-corp-andina")

const EsquemaSolicitud = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
})

const EsquemaPlantillaCeldas = z.array(
  z.object({ hoja: z.string(), celda_etiqueta: z.string(), etiqueta: z.string(), celda_valor: z.string() }),
)

const EsquemaPlantillaCampos = z.array(z.object({ etiqueta: z.string(), obligatorio: z.boolean() }))

const EsquemaSoportesExigidos = z.array(z.string())

const EsquemaMaestro = z.record(z.string(), z.unknown())

const EsquemaGlosario = z.record(z.string(), z.string())

const EsquemaIndiceSoportes = z.array(
  z.object({
    tipo: z.string(),
    archivo: z.string(),
    vigencia_hasta: z.string().nullable(), // null = no vence
    pais_emisor: z.string(),
    descripcion: z.string(),
  }),
)

// ---------- Tipos que usa el resto del código ----------

export type Solicitud = z.infer<typeof EsquemaSolicitud>
export type Maestro = z.infer<typeof EsquemaMaestro>
export type Glosario = z.infer<typeof EsquemaGlosario>
export type SoporteIndexado = z.infer<typeof EsquemaIndiceSoportes>[number]

// Campo pedido por el cliente; hoja y celdas solo existen en Excel.
export type Campo = {
  etiqueta: string
  obligatorio?: boolean
  hoja?: string
  celda_etiqueta?: string
  celda_valor?: string
}

export type CasoCargado = {
  solicitud: Solicitud
  campos: Campo[]
  soportesExigidos: string[]
}

// ---------- Carga de datos ----------

async function listarCasos(ctx: Ctx): Promise<string[]> {
  try {
    const entradas = await readdir(rutasBase(ctx).casos, { withFileTypes: true })
    return entradas
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export async function cargarSolicitud(ctx: Ctx, caso: string): Promise<Solicitud> {
  const carpeta = join(rutasBase(ctx).casos, caso)
  if (!existsSync(carpeta)) {
    const disponibles = (await listarCasos(ctx)).join(", ") || "ninguno"
    throw new ErrorHerramienta(`El caso "${caso}" no existe. Casos disponibles: ${disponibles}.`)
  }
  return leerJson(join(carpeta, "solicitud.json"), EsquemaSolicitud, `${caso}/solicitud.json`)
}

// Carga solicitud + plantilla (según el formato) + soportes exigidos.
export async function cargarCaso(ctx: Ctx, caso: string): Promise<CasoCargado> {
  const solicitud = await cargarSolicitud(ctx, caso)
  const carpeta = join(rutasBase(ctx).casos, caso)

  let campos: Campo[]
  if (solicitud.formato === "xlsx") {
    campos = await leerJson(join(carpeta, "plantilla-celdas.json"), EsquemaPlantillaCeldas, `${caso}/plantilla-celdas.json`)
  } else {
    campos = await leerJson(join(carpeta, "plantilla-campos.json"), EsquemaPlantillaCampos, `${caso}/plantilla-campos.json`)
  }

  const soportesExigidos = await cargarSoportesExigidos(ctx, caso)
  return { solicitud, campos, soportesExigidos }
}

export const cargarSoportesExigidos = (ctx: Ctx, caso: string) =>
  leerJson(join(rutasBase(ctx).casos, caso, "soportes-exigidos.json"), EsquemaSoportesExigidos, `${caso}/soportes-exigidos.json`)

export const cargarMaestro = (ctx: Ctx) =>
  leerJson(rutasBase(ctx).maestro, EsquemaMaestro, "repositorio/maestro.json")

export const cargarGlosario = (ctx: Ctx) =>
  leerJson(rutasBase(ctx).glosario, EsquemaGlosario, "glosario-campos.json")

export const cargarIndiceSoportes = (ctx: Ctx) =>
  leerJson(join(rutasBase(ctx).soportes, "index.json"), EsquemaIndiceSoportes, "repositorio/soportes/index.json")
