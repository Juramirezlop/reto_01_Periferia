import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fechaEjecucion, rutasBase, type Ctx } from "../../modulo/tools/util"

// Quita el bloque de metadatos (---) del inicio de un archivo .md.
const sinMetadatos = (texto: string) => texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")

// Arma el mensaje de sistema: prompt y conocimiento (de modulo/), fecha y casos disponibles.
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

// ¿El mensaje confirma el envío? Un "no" lo anula; un "sí" suelto solo vale
// si el agente acababa de pedir confirmación.
export function confirmaEnvio(texto: string, ultimoDelAgente = ""): boolean {
  const t = texto.toLowerCase()
  if (/\bno\b/.test(t)) return false
  if (/\b(confirmo|confirmado|confirmada|env[ií]alo|env[ií]ala|adelante|s[ií],? env[ií]a)\b/.test(t)) return true
  // Se usa (?!letra) y no \b porque \b falla con tildes como la í de "sí".
  return /^\s*(s[ií]|ok|dale|de acuerdo)(?![a-záéíóúñ])/.test(t) && /confirm/i.test(ultimoDelAgente)
}
