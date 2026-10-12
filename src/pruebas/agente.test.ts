import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, test } from "bun:test"
import { responder, type Sesion } from "../agent/loop"
import { ejecutar } from "../agent/herramientas"
import { confirmaEnvio, construirSistema } from "../agent/sistema"
import { prepararCasos } from "../preparar"
import { ErrorModelo, type Adaptador, type Entrada, type Llamada } from "../llm/adapter"
import { crearGemini } from "../llm/gemini"

const ctx = { directory: process.cwd(), sessionId: "prueba" }
beforeAll(() => {
  process.env.FECHA_EJECUCION = "2026-09-03"
})

// Modelo simulado: en cada turno entrega la siguiente respuesta del guion.
function guion(...turnos: { texto?: string; llamadas?: Llamada[] }[]): Adaptador {
  let i = 0
  return { generar: async () => ({ texto: turnos[i]?.texto ?? "", llamadas: turnos[i++]?.llamadas ?? [] }) }
}
const llamar = (nombre: string, args: unknown): Llamada => ({ nombre, args })
const correr = (adaptadores: Adaptador[], mensaje: string, sesion: Sesion = { historial: [], tokens: 0 }, limites = { maxPasos: 8, maxTokens: 1000 }) =>
  responder({ adaptadores, sistema: "prueba", sesion, limites, mensaje, ctx })

describe("ciclo del agente", () => {
  test("ejecuta herramientas pedidas por el modelo y responde", async () => {
    const modelo = guion(
      { llamadas: [llamar("proveedor_armar_paquete", { caso: "ec-corp-andina" })] },
      { texto: "Listo: falta un soporte." },
    )
    const r = await correr([modelo], "Procesa ec-corp-andina")
    expect(r.herramientas).toEqual([{ nombre: "proveedor_armar_paquete", ok: true }])
    expect(r.respuesta).toBe("Listo: falta un soporte.")
  })

  test("el modelo NO puede confirmar un envío (aunque mande confirmado:true)", async () => {
    const r = await ejecutar("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: true }, ctx, false)
    expect(JSON.parse(r)).toEqual({ ok: false, error: "requiere confirmación explícita" })
  })

  test("con confirmación del usuario el envío se simula", async () => {
    await ejecutar("proveedor_armar_paquete", { caso: "co-industrias-delta" }, ctx, false) // el envío exige paquete armado
    const r = await ejecutar("proveedor_simular_envio", { caso: "co-industrias-delta" }, ctx, true)
    expect(JSON.parse(r).ok).toBe(true)
  })

  test("un \"sí\" solo confirma si el agente acababa de pedir confirmación", () => {
    expect(confirmaEnvio("sí", "¿Confirmas el envío?")).toBe(true)
    expect(confirmaEnvio("sí", "Aquí tienes el resumen.")).toBe(false)
    expect(confirmaEnvio("no, espera", "¿Confirmas el envío?")).toBe(false)
  })

  test("el tope de tokens por sesión detiene el ciclo antes de llamar al modelo", async () => {
    const modelo: Adaptador = { generar: async () => Promise.reject(new Error("no debió llamarse")) }
    const r = await correr([modelo], "hola", { historial: [], tokens: 1000 })
    expect(r.respuesta).toContain("límite de uso")
  })

  test("suma los tokens que gasta cada respuesta", async () => {
    const sesion: Sesion = { historial: [], tokens: 0 }
    const modelo: Adaptador = { generar: async () => ({ texto: "ok", llamadas: [], tokens: 120 }) }
    await correr([modelo], "hola", sesion)
    expect(sesion.tokens).toBe(120)
  })

  test("detecta confirmaciones y negaciones", () => {
    expect(confirmaEnvio("Sí, confirmo el envío")).toBe(true)
    expect(confirmaEnvio("No envíes nada todavía")).toBe(false)
    expect(confirmaEnvio("Procesa el caso")).toBe(false)
  })

  test("usa el modelo de respaldo si el principal falla", async () => {
    const caido: Adaptador = { generar: async () => Promise.reject(new ErrorModelo("tiempo agotado", true)) }
    const r = await correr([caido, guion({ texto: "respuesta del respaldo" })], "hola")
    expect(r.respuesta).toBe("respuesta del respaldo")
  })

  test("un error no reintentable no usa el respaldo y responde con mensaje claro", async () => {
    const malo: Adaptador = { generar: async () => Promise.reject(new ErrorModelo("HTTP 403", false)) }
    const r = await correr([malo, guion({ texto: "no debería verse" })], "hola")
    expect(r.respuesta).toContain("No pude consultar el modelo")
  })

  test("corta el ciclo si el modelo pide herramientas sin parar", async () => {
    const infinito: Adaptador = {
      generar: async () => ({ texto: "", llamadas: [llamar("proveedor_leer_solicitud", { caso: "ec-corp-andina" })] }),
    }
    const r = await correr([infinito], "hola", undefined, { maxPasos: 8, maxTokens: 1000 })
    expect(r.respuesta).toContain("límite")
    expect(r.herramientas.length).toBe(8)
  })

  test("herramienta inexistente y argumentos inválidos devuelven error, no excepción", async () => {
    expect(JSON.parse(await ejecutar("inventada", {}, ctx, false)).ok).toBe(false)
    expect(JSON.parse(await ejecutar("proveedor_leer_solicitud", { caso: "../x" }, ctx, false)).ok).toBe(false)
  })
})

describe("datos sensibles y reglas de negocio", () => {
  test("el modelo no recibe el número de cuenta completo", async () => {
    const r = await ejecutar("proveedor_mapear_campos", { caso: "co-industrias-delta", campos: ["Número de cuenta"] }, ctx, false)
    expect(r).not.toContain("03100012345")
    expect(r).toContain("***2345")
  })

  test("ec-corp-andina no queda listo para firma (soporte ausente)", async () => {
    const r = JSON.parse(await ejecutar("proveedor_armar_paquete", { caso: "ec-corp-andina" }, ctx, false))
    expect(r.data.listo_para_firma).toBe(false)
  })
})

describe("adaptador de Gemini (fetch simulado)", () => {
  const original = globalThis.fetch
  const simular = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    globalThis.fetch = ((url: string, init: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch
  }
  const gemini = () => crearGemini({ apiKey: "k", modelo: "m", timeoutMs: 200 })
  const entrada = { sistema: "s", historial: [{ tipo: "usuario", texto: "hola" } as Entrada], herramientas: [] }

  test("lee texto y llamadas, y conserva el mensaje crudo", async () => {
    simular(() => Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "hola" }, { functionCall: { name: "f", args: { a: 1 } }, thoughtSignature: "xyz" }] } }] }))
    const r = await gemini().generar(entrada)
    expect(r.texto).toBe("hola")
    expect(r.llamadas).toEqual([{ nombre: "f", args: { a: 1 } }])
    expect(JSON.stringify(r.crudo)).toContain("xyz")
    globalThis.fetch = original
  })

  test("429 es reintentable y 403 no", async () => {
    simular(() => new Response("límite", { status: 429 }))
    expect(await gemini().generar(entrada).catch((e) => e)).toMatchObject({ reintentable: true })
    simular(() => new Response("clave", { status: 403 }))
    expect(await gemini().generar(entrada).catch((e) => e)).toMatchObject({ reintentable: false })
    globalThis.fetch = original
  })

  test("agrupa resultados de herramientas en un solo mensaje y envía la clave en el encabezado", async () => {
    let enviado: { contents: { role: string; parts: unknown[] }[] } | undefined
    const claves: (string | null)[] = []
    simular((_url, init) => {
      enviado = JSON.parse(String(init.body))
      claves.push(new Headers(init.headers).get("x-goog-api-key"))
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] })
    })
    await gemini().generar({
      ...entrada,
      historial: [
        { tipo: "usuario", texto: "x" },
        { tipo: "modelo", texto: "", llamadas: [{ nombre: "a", args: {} }, { nombre: "b", args: {} }] },
        { tipo: "resultado", nombre: "a", contenido: "{}" },
        { tipo: "resultado", nombre: "b", contenido: "{}" },
      ],
    })
    expect(claves).toEqual(["k"])
    expect(enviado?.contents.length).toBe(3)
    expect(enviado?.contents[2]?.parts.length).toBe(2)
    globalThis.fetch = original
  })
})

describe("errores controlados (HU-5)", () => {
  test("una plantilla corrupta da mensaje claro y el siguiente caso sigue funcionando", async () => {
    // Copia de los fixtures en una carpeta temporal para no dañar los originales.
    const temporal = mkdtempSync(join(tmpdir(), "reto01-"))
    await cp(join(ctx.directory, "fixtures"), join(temporal, "fixtures"), { recursive: true })
    writeFileSync(join(temporal, "fixtures", "reto-01", "casos", "ec-corp-andina", "plantilla-campos.json"), "{ no es json")
    const ctxTemporal = { directory: temporal, sessionId: "corrupta" }

    const malo = JSON.parse(await ejecutar("proveedor_leer_solicitud", { caso: "ec-corp-andina" }, ctxTemporal, false))
    expect(malo.ok).toBe(false)
    expect(malo.error).toContain("corrupto")
    expect(malo.error).not.toContain("at ") // sin traza cruda

    const bueno = JSON.parse(await ejecutar("proveedor_leer_solicitud", { caso: "co-industrias-delta" }, ctxTemporal, false))
    expect(bueno.ok).toBe(true)
    rmSync(temporal, { recursive: true, force: true })
  })

  test("un caso de portal responde formato no soportado y deja los valores para copiar", async () => {
    const r = JSON.parse(await ejecutar("proveedor_generar_formulario", { caso: "pa-logistica-istmo" }, ctx, false))
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.data)).toContain("no soportado")
    expect(existsSync(join(ctx.directory, "out", "pa-logistica-istmo", "valores-portal.md"))).toBe(true)
  })
})

describe("ahorro de llamadas", () => {
  test("si el modelo repite la misma llamada en un mensaje, la herramienta corre una sola vez", async () => {
    const igual = llamar("proveedor_leer_solicitud", { caso: "ec-corp-andina" })
    const modelo = guion({ llamadas: [igual, igual] }, { texto: "listo" })
    await ejecutar("proveedor_armar_paquete", { caso: "ec-corp-andina" }, ctx, false) // crea out/ec-corp-andina
    const registro = join(ctx.directory, "out", "ec-corp-andina", "log.jsonl")
    const antes = (await Bun.file(registro).text()).split("\n").filter((l) => l.includes("leer_solicitud")).length
    const r = await correr([modelo], "hola")
    const despues = (await Bun.file(registro).text()).split("\n").filter((l) => l.includes("leer_solicitud")).length
    expect(despues - antes).toBe(1)
    expect(r.herramientas.length).toBe(2) // se informan las dos llamadas, pero solo una se ejecutó
  })
})

describe("módulo exportable (modulo/)", () => {
  test("las herramientas se importan sin el servidor y son las 5 del contrato", async () => {
    const herramientas = await import("../../modulo/tools/proveedor")
    expect(Object.keys(herramientas).sort()).toEqual(["armar_paquete", "generar_formulario", "leer_solicitud", "mapear_campos", "simular_envio"])
    for (const h of Object.values(herramientas)) {
      expect(typeof h.description).toBe("string")
      expect(typeof h.execute).toBe("function")
    }
  })

  test("el sistema del agente usa el mismo prompt y conocimiento que modulo/ (sin copias)", async () => {
    const quitar = (t: string) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    const prompt = quitar(await Bun.file(join(ctx.directory, "modulo", "agent.md")).text())
    const skill = quitar(await Bun.file(join(ctx.directory, "modulo", "skill", "registro-proveedor", "SKILL.md")).text())
    const sistema = await construirSistema(ctx)
    expect(sistema).toContain(prompt.trim())
    expect(sistema).toContain(skill.trim())
    expect(sistema).not.toContain("mode: primary") // los metadatos no llegan al modelo
  })

  test("agent.md y SKILL.md traen los metadatos que pide el PRD", async () => {
    const agente = await Bun.file(join(ctx.directory, "modulo", "agent.md")).text()
    expect(agente).toMatch(/^---\r?\n[\s\S]*description:[\s\S]*mode: primary[\s\S]*edit: deny[\s\S]*bash: deny[\s\S]*---/)
    const skill = await Bun.file(join(ctx.directory, "modulo", "skill", "registro-proveedor", "SKILL.md")).text()
    expect(skill).toMatch(/^---\r?\nname: registro-proveedor\r?\ndescription:/)
  })
})

describe("preparación al arrancar", () => {
  test("arma los paquetes que faltan y no repite los que ya están al día", async () => {
    rmSync(join(ctx.directory, "out"), { recursive: true, force: true })
    expect((await prepararCasos()).length).toBe(4)
    for (const caso of ["co-industrias-delta", "pa-logistica-istmo"]) {
      const estado = await Bun.file(join(ctx.directory, "out", caso, "estado.json")).json()
      expect(estado.listo_para_firma).toBe(true)
    }
    expect(await prepararCasos()).toEqual([]) // segunda vez: nada que hacer
  })
})
