// Chat por terminal con el agente
import { manejarMensaje } from "../app"

console.log('Agente de registro de proveedores. Escribe "salir" para terminar.\n')

while (true) {
  const mensaje = prompt("Tú:")?.trim() // lee una línea de la terminal
  if (mensaje === undefined || mensaje === "salir") break
  if (!mensaje) continue
  const { respuesta, herramientas, tokens } = await manejarMensaje("terminal", mensaje)
  if (herramientas.length) console.log(`  [herramientas: ${herramientas.map((h) => `${h.nombre}${h.ok ? "" : " ✗"}`).join(", ")}]`)
  console.log(`\nAgente: ${respuesta}\n`)
  if (tokens) console.log(`  [tokens usados en la sesión: ${tokens}]\n`)
}
