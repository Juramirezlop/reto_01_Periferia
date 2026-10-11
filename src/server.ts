import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { z } from "zod"
import { manejarMensaje, reiniciarSesion } from "./app"
import { config } from "./config"
import { ejecutar } from "./agent/herramientas"
import { fechaEjecucion, rutaOutCaso, rutasBase } from "./tools/util"
import { nombreCaso } from "./tools/datos"

const EsquemaChat = z.object({ sessionId: z.string().min(1).max(64), mensaje: z.string().min(1).max(4000) })
const json = (datos: unknown, status = 200) => Response.json(datos, { status })
const dirWeb = join(process.cwd(), "web", "dist") // el front compilado (paso siguiente)

Bun.serve({
  port: config.puerto,
  async fetch(req) {
    const { pathname } = new URL(req.url)

    if (pathname === "/api/salud") {
      return json({ ok: true, modelo: config.modelo, clave: Boolean(config.apiKey), fecha: fechaEjecucion() })
    }

    // Vista del caso para el panel: calculada solo con las herramientas (sin modelo).
    const rutaCaso = pathname.match(/^\/api\/caso\/([^/]+)$/)
    if (rutaCaso) {
      const ctx = { directory: process.cwd(), sessionId: "panel" }
      const caso = nombreCaso.safeParse(rutaCaso[1])
      if (!caso.success) return json({ error: "Nombre de caso inválido." }, 400)
      const leida = JSON.parse(await ejecutar("proveedor_leer_solicitud", { caso: caso.data }, ctx, false))
      if (!leida.ok) return json({ error: leida.error }, 404)
      const etiquetas = (leida.data.campos as { etiqueta: string }[]).map((c) => c.etiqueta)
      const mapeo = JSON.parse(await ejecutar("proveedor_mapear_campos", { caso: caso.data, campos: etiquetas }, ctx, false))
      const estado = await Bun.file(join(rutaOutCaso(ctx, caso.data), "estado.json")).json().catch(() => null)
      const archivos = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: join(rutaOutCaso(ctx, caso.data), "paquete") })).catch(() => [])
      // Un estado calculado con otra fecha de ejecución ya no es confiable: el panel pide reprocesar.
      const obsoleto = estado !== null && estado.fecha !== fechaEjecucion()
      return json({ solicitud: leida.data, mapeo: mapeo.data, estado, obsoleto, archivos })
    }

    // Descarga de un archivo generado, siempre dentro de out/<caso>/
    const rutaArchivo = pathname.match(/^\/api\/archivo\/([^/]+)\/(.+)$/)
    if (rutaArchivo) {
      const caso = nombreCaso.safeParse(rutaArchivo[1])
      if (!caso.success) return json({ error: "Nombre de caso inválido." }, 400)
      const base = resolve(rutaOutCaso({ directory: process.cwd(), sessionId: "panel" }, caso.data))
      const destino = resolve(base, decodeURIComponent(rutaArchivo[2] ?? ""))
      const valido = destino.startsWith(base + sep) && (await stat(destino).then((s) => s.isFile()).catch(() => false))
      return valido ? new Response(Bun.file(destino)) : json({ error: "Archivo no encontrado." }, 404)
    }

    if (pathname === "/api/casos") {
      const entradas = await readdir(rutasBase({ directory: process.cwd(), sessionId: "web" }).casos, { withFileTypes: true })
      return json(entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort())
    }

    if (pathname === "/api/chat" && req.method === "POST") {
      const cuerpo = EsquemaChat.safeParse(await req.json().catch(() => null))
      if (!cuerpo.success) return json({ error: "Envía { sessionId, mensaje }." }, 400)
      return json(await manejarMensaje(cuerpo.data.sessionId, cuerpo.data.mensaje))
    }

    if (pathname === "/api/reiniciar" && req.method === "POST") {
      const cuerpo = EsquemaChat.pick({ sessionId: true }).safeParse(await req.json().catch(() => null))
      if (cuerpo.success) reiniciarSesion(cuerpo.data.sessionId)
      return json({ ok: true })
    }

    // Archivos del front (si ya está compilado)
    const archivo = join(dirWeb, pathname === "/" ? "index.html" : pathname)
    if (archivo.startsWith(dirWeb) && existsSync(archivo)) return new Response(Bun.file(archivo))
    return json({ error: "No encontrado" }, 404)
  },
})
console.log(`Servidor en http://localhost:${config.puerto}  (modelo: ${config.modelo})`)
