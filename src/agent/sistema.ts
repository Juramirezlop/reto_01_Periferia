import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fechaEjecucion, rutasBase, type Ctx } from "../../modulo/tools/util"

// Quita el bloque de metadatos
const sinMetadatos = (texto: string) => texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")

// Arma el mensaje de sistema desde el prompt
export async function construirSistema(ctx: Ctx): Promise<string> {
  const prompt = sinMetadatos(await readFile(join(ctx.directory, "modulo", "agent.md"), "utf8"))
  const conocimiento = sinMetadatos(await readFile(join(ctx.directory, "modulo", "skill", "registro-proveedor", "SKILL.md"), "utf8"))
  let casos = "ninguno"
  try {
    const entradas = await readdir(rutasBase(ctx).casos, { withFileTypes: true })
    casos = entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort().join(", ") || "ninguno"
  } catch {}
  return `${prompt}\n\n${conocimiento}\n\nFecha de ejecución: ${fechaEjecucion()}\nCasos disponibles: ${casos}`
}

// Mensaje de confirmación
export function confirmaEnvio(texto: string, ultimoDelAgente = ""): boolean {
  const t = texto.toLowerCase()
  if (/\bno\b/.test(t)) return false
  if (/\b(confirmo|confirmado|confirmada|env[ií]alo|env[ií]ala|adelante|s[ií],? env[ií]a)\b/.test(t)) return true
  return /^\s*(s[ií]|ok|dale|de acuerdo)(?![a-záéíóúñ])/.test(t) && /confirm/i.test(ultimoDelAgente)
}
