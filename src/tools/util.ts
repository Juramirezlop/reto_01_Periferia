import { existsSync } from "node:fs"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

// Lo que el servidor (o demo.ts) le entrega a cada herramienta.
// directory = raíz del proyecto. Todas las rutas se arman desde aquí.
export type Ctx = { directory: string; sessionId: string }

// Error "esperado": lleva un mensaje claro para la analista, sin traza.
export class ErrorHerramienta extends Error {}

// Lo que devuelve la lógica de cada herramienta cuando todo sale bien.
export type Resultado = { data: unknown; resumen: string }

// ---------- Rutas ----------

export function rutasBase(ctx: Ctx) {
  const fixtures = join(ctx.directory, "fixtures", "reto-01")
  return {
    casos: join(fixtures, "casos"),
    glosario: join(fixtures, "glosario-campos.json"),
    maestro: join(fixtures, "repositorio", "maestro.json"),
    soportes: join(fixtures, "repositorio", "soportes"),
    out: join(ctx.directory, "out"),
  }
}

export const rutaOutCaso = (ctx: Ctx, caso: string) => join(rutasBase(ctx).out, caso)

// ---------- Fecha ----------

// Fecha contra la que se compara la vigencia de los soportes (YYYY-MM-DD).
// Se puede fijar con la variable FECHA_EJECUCION; si no, es la fecha de hoy.
export function fechaEjecucion(): string {
  const fijada = process.env.FECHA_EJECUCION
  if (fijada && /^\d{4}-\d{2}-\d{2}$/.test(fijada)) return fijada
  return new Date().toLocaleDateString("sv-SE") // formato YYYY-MM-DD en hora local
}

// ---------- Textos y datos ----------

// "Identificación Tributaria " -> "identificacion tributaria" (para comparar etiquetas)
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// obtenerPorRuta(maestro, "banco.numero_cuenta") -> maestro.banco.numero_cuenta
export function obtenerPorRuta(obj: unknown, ruta: string): unknown {
  let actual: unknown = obj
  for (const clave of ruta.split(".")) {
    if (typeof actual !== "object" || actual === null) return undefined
    actual = (actual as Record<string, unknown>)[clave]
  }
  return actual
}

// Lee un JSON y lo valida con un esquema zod. Si algo falla, lanza un mensaje claro.
export async function leerJson<S extends z.ZodType>(
  ruta: string,
  esquema: S,
  nombre: string,
): Promise<z.infer<S>> {
  let texto: string
  try {
    texto = await readFile(ruta, "utf8")
  } catch {
    throw new ErrorHerramienta(`No se encontró el archivo ${nombre}.`)
  }
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    throw new ErrorHerramienta(`El archivo ${nombre} está corrupto (no es un JSON válido).`)
  }
  const resultado = esquema.safeParse(json)
  if (!resultado.success) {
    const problema = resultado.error.issues[0]
    const donde = problema?.path.join(".") || "raíz"
    throw new ErrorHerramienta(
      `El archivo ${nombre} no tiene la estructura esperada (${donde}: ${problema?.message ?? "formato inválido"}).`,
    )
  }
  return resultado.data
}

// ---------- Registro (log.jsonl) ----------

async function registrar(
  ctx: Ctx,
  herramienta: string,
  caso: string | undefined,
  ok: boolean,
  resumen: string,
): Promise<void> {
  const linea =
    JSON.stringify({ ts: new Date().toISOString(), sessionId: ctx.sessionId, caso, herramienta, ok, resumen }) + "\n"
  try {
    const { out, casos } = rutasBase(ctx)
    await mkdir(out, { recursive: true })
    await appendFile(join(out, "log.jsonl"), linea) // log global (CA4)
    if (caso && existsSync(join(casos, caso))) {
      await mkdir(rutaOutCaso(ctx, caso), { recursive: true })
      await appendFile(join(rutaOutCaso(ctx, caso), "log.jsonl"), linea) // log por caso (RN5)
    }
  } catch {
    // Un fallo al escribir el log nunca debe romper la herramienta.
  }
}

function extraerCaso(args: unknown): string | undefined {
  if (typeof args === "object" && args !== null && "caso" in args) {
    const caso = (args as { caso: unknown }).caso
    return typeof caso === "string" ? caso : undefined
  }
  return undefined
}

// ---------- Contrato de herramienta ----------

// Convierte la lógica de una herramienta en el objeto { description, args, execute }
// que pide el PRD. Aquí se garantiza que execute:
//   1) valida los argumentos con zod, 2) nunca lanza, 3) devuelve un string JSON
//   con { ok: true, data } o { ok: false, error }, 4) deja registro en el log.
export function definirHerramienta<S extends z.ZodRawShape>(def: {
  nombre: string
  description: string
  args: S
  run: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<Resultado>
}) {
  const esquema = z.object(def.args)

  return {
    description: def.description,
    args: def.args,
    async execute(args: unknown, ctx: Ctx): Promise<string> {
      const caso = extraerCaso(args)
      const parseo = esquema.safeParse(args)
      if (!parseo.success) {
        const problema = parseo.error.issues[0]
        const error = `Argumentos inválidos (${problema?.path.join(".") || "raíz"}: ${problema?.message ?? "formato inválido"}).`
        await registrar(ctx, def.nombre, caso, false, error)
        return JSON.stringify({ ok: false, error })
      }
      try {
        const { data, resumen } = await def.run(parseo.data, ctx)
        await registrar(ctx, def.nombre, caso, true, resumen)
        return JSON.stringify({ ok: true, data })
      } catch (e) {
        const error =
          e instanceof ErrorHerramienta
            ? e.message
            : `Error inesperado: ${e instanceof Error ? e.message : String(e)}`
        await registrar(ctx, def.nombre, caso, false, error)
        return JSON.stringify({ ok: false, error })
      }
    },
  }
}
