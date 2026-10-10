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

// ¿El último mensaje del usuario confirma el envío? Conservador: cualquier "no" lo anula.
export function confirmaEnvio(texto: string): boolean {
  const t = texto.toLowerCase()
  if (/\bno\b/.test(t)) return false
  return /\b(confirmo|confirmado|confirmada|env[ií]alo|env[ií]ala|adelante|s[ií],? env[ií]a)\b/.test(t)
}
