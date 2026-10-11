import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fechaEjecucion, rutasBase, type Ctx } from "../tools/util"

// Arma el mensaje de sistema: prompt + conocimiento + fecha + casos disponibles.
export async function construirSistema(ctx: Ctx): Promise<string> {
  const prompt = await readFile(join(ctx.directory, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(ctx.directory, "src", "knowledge", "registro-proveedor.md"), "utf8")
  let casos = "ninguno"
  try {
    const entradas = await readdir(rutasBase(ctx).casos, { withFileTypes: true })
    casos = entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort().join(", ") || "ninguno"
  } catch {}
  return `${prompt}\n\n${conocimiento}\n\nFecha de ejecución: ${fechaEjecucion()}\nCasos disponibles: ${casos}`
}

// ¿El mensaje de la analista confirma el envío? Conservador: cualquier "no" lo anula.
// Un "sí" suelto solo vale si lo último que dijo el agente fue pedir confirmación.
export function confirmaEnvio(texto: string, ultimoDelAgente = ""): boolean {
  const t = texto.toLowerCase()
  if (/\bno\b/.test(t)) return false
  if (/\b(confirmo|confirmado|confirmada|env[ií]alo|env[ií]ala|adelante|s[ií],? env[ií]a)\b/.test(t)) return true
  // (?![a-z...]) en lugar de \b: \b no se lleva bien con letras con tilde como la í de "sí".
  return /^\s*(s[ií]|ok|dale|de acuerdo)(?![a-záéíóúñ])/.test(t) && /confirm/i.test(ultimoDelAgente)
}
