// Las 5 herramientas del agente
import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
  type CasoCargado,
  cargarCaso,
  cargarGlosario,
  cargarIndiceSoportes,
  cargarMaestro,
  cargarSolicitud,
  cargarSoportesExigidos,
  type Maestro,
  nombreCaso,
} from "./datos"
import { generarPdf, generarValoresPortal, generarXlsx } from "./formularios"
import { esAmbigua, ID_TRIBUTARIO, type Mapeo, mapearCampos, ocultarSensibles, valoresPorEtiqueta } from "./mapeo"
import {
  type Ctx,
  definirHerramienta,
  ErrorHerramienta,
  fechaEjecucion,
  leerJson,
  MENSAJE_SIN_CONFIRMACION,
  obtenerPorRuta,
  rutaOutCaso,
  rutasBase,
} from "./util"

// ---------- Piezas internas compartidas ----------

// Carga el caso y recalcula el mapeo desde los archivos
async function prepararCaso(ctx: Ctx, caso: string) {
  const datos = await cargarCaso(ctx, caso)
  const [maestro, glosario] = await Promise.all([cargarMaestro(ctx), cargarGlosario(ctx)])
  const mapeo = mapearCampos(datos.campos.map((c) => c.etiqueta), datos.solicitud.pais, glosario, maestro)
  return { datos, maestro, mapeo }
}

type FormularioCreado = { ruta: string; formato: "xlsx" | "pdf" | "portal"; archivo: string; aviso?: string }

// Crea la salida según el formato pedido.
async function crearFormulario(ctx: Ctx, caso: string, datos: CasoCargado, maestro: Maestro, mapeo: Mapeo): Promise<FormularioCreado> {
  const carpeta = rutaOutCaso(ctx, caso)
  await mkdir(carpeta, { recursive: true })
  const valores = valoresPorEtiqueta(mapeo)
  const { formato, cliente } = datos.solicitud

  if (formato === "xlsx") {
    await generarXlsx(datos.campos, valores, join(carpeta, "formulario.xlsx"))
    return { ruta: `out/${caso}/formulario.xlsx`, formato, archivo: "formulario.xlsx" }
  }
  if (formato === "pdf") {
    const firmante = String(obtenerPorRuta(maestro, "representante_legal.nombre") ?? "")
    await generarPdf(`Formulario de proveedor - ${cliente}`, datos.campos, valores, firmante, join(carpeta, "formulario.pdf"))
    return { ruta: `out/${caso}/formulario.pdf`, formato, archivo: "formulario.pdf" }
  }
  await generarValoresPortal(cliente, datos.campos, mapeo, valores, join(carpeta, "valores-portal.md"))
  return {
    ruta: `out/${caso}/valores-portal.md`,
    formato,
    archivo: "valores-portal.md",
    aviso: "formato no soportado: el portal web lo opera una persona; se dejaron los valores listos para copiar.",
  }
}

type EstadoSoporte = {
  tipo: string
  estado: "presente" | "vencido" | "ausente"
  archivo?: string
  vigencia_hasta?: string | null
  detalle: string
}

// Revisa cada soporte exigido contra el índice y la fecha de ejecución
async function revisarSoportes(ctx: Ctx, exigidos: string[], hoy: string): Promise<EstadoSoporte[]> {
  const indice = await cargarIndiceSoportes(ctx)
  const carpeta = rutasBase(ctx).soportes

  return exigidos.map((tipo): EstadoSoporte => {
    const soporte = indice.find((s) => s.tipo === tipo)
    if (!soporte) return { tipo, estado: "ausente", detalle: "No existe en el repositorio de soportes." }
    if (!existsSync(join(carpeta, soporte.archivo))) {
      return { tipo, estado: "ausente", archivo: soporte.archivo, detalle: `El índice lo lista, pero falta el archivo ${soporte.archivo}.` }
    }
    // Las fechas ISO se comparan como texto
    if (soporte.vigencia_hasta !== null && soporte.vigencia_hasta < hoy) {
      return { tipo, estado: "vencido", archivo: soporte.archivo, vigencia_hasta: soporte.vigencia_hasta, detalle: `Venció el ${soporte.vigencia_hasta}; hay que actualizarlo.` }
    }
    return {
      tipo,
      estado: "presente",
      archivo: soporte.archivo,
      vigencia_hasta: soporte.vigencia_hasta,
      detalle: soporte.vigencia_hasta ? `Vigente hasta ${soporte.vigencia_hasta}.` : "No vence.",
    }
  })
}

const EsquemaEstadoPaquete = z.object({
  listo_para_firma: z.boolean(),
  bloqueos: z.array(z.string()),
  etapa: z.string(), // "firma" o "carga en portal"
  fecha: z.string().optional(), // fecha con la que se calculó el estado
})

// ---------- Herramienta 1 ----------

export const leer_solicitud = definirHerramienta({
  nombre: "proveedor_leer_solicitud",
  description:
    "Lee el correo del cliente y su plantilla: devuelve país, cliente, formato de salida (xlsx, pdf o portal), los campos solicitados, los soportes exigidos y las etiquetas ambiguas.",
  args: { caso: nombreCaso },
  async run({ caso }, ctx) {
    const { solicitud, campos, soportesExigidos } = await cargarCaso(ctx, caso)
    const propuesta = ID_TRIBUTARIO[solicitud.pais] ?? "identificador tributario del país"
    const ambiguos = campos
      .filter((c) => esAmbigua(c.etiqueta))
      .map((c) => ({ etiqueta: c.etiqueta, estado: "requiere_confirmacion", propuesta }))

    return {
      data: {
        pais: solicitud.pais,
        cliente: solicitud.cliente,
        formato: solicitud.formato,
        campos,
        soportes: soportesExigidos,
        ambiguos,
      },
      resumen: `${solicitud.cliente} (${solicitud.pais}), formato ${solicitud.formato}: ${campos.length} campos, ${soportesExigidos.length} soportes.`,
    }
  },
})

// ---------- Herramienta 2 (mapeo)  ----------

export const mapear_campos = definirHerramienta({
  nombre: "proveedor_mapear_campos",
  description:
    "Cruza las etiquetas de los campos solicitados con el repositorio maestro. Devuelve cada campo como lleno (con la ruta del dato), faltante o requiere_confirmacion. Nunca inventa valores.",
  args: {
    caso: nombreCaso,
    campos: z.array(z.string()).describe("Etiquetas de los campos a mapear, tal como las devolvió proveedor_leer_solicitud"),
  },
  async run({ caso, campos }, ctx) {
    const solicitud = await cargarSolicitud(ctx, caso)
    const [maestro, glosario] = await Promise.all([cargarMaestro(ctx), cargarGlosario(ctx)])
    const mapeo = mapearCampos(campos, solicitud.pais, glosario, maestro)

    return {
      data: ocultarSensibles(mapeo), // bancarios enmascarados
      resumen: `${mapeo.llenos.length} llenos, ${mapeo.faltantes.length} faltantes, ${mapeo.requiere_confirmacion.length} por confirmar.`,
    }
  },
})

// ---------- Herramienta 3 (formularios) ----------

export const generar_formulario = definirHerramienta({
  nombre: "proveedor_generar_formulario",
  description:
    "Genera el formulario lleno en el formato que pidió el cliente (Excel o PDF) y deja en out/<caso>/. Si el formato es portal web, no lo soporta y deja los valores para copiar.",
  args: {
    caso: nombreCaso,
    mapeo: z
      .unknown()
      .optional()
      .describe("Opcional y se ignora: el mapeo se recalcula desde el maestro para que ningún valor pueda ser alterado."),
  },
  async run({ caso }, ctx) {
    const { datos, maestro, mapeo } = await prepararCaso(ctx, caso)
    const formulario = await crearFormulario(ctx, caso, datos, maestro, mapeo)
    const { archivo: _archivo, ...data } = formulario
    return { data, resumen: `Generado ${formulario.ruta}${formulario.aviso ? " (formato no soportado)" : ""}.` }
  },
})

// ---------- Herramienta 4 (paquete) ----------

export const armar_paquete = definirHerramienta({
  nombre: "proveedor_armar_paquete",
  description:
    "Arma out/<caso>/paquete/ con el formulario, los soportes exigidos que existan, un checklist (presentes, ausentes, vencidos) y un borrador de correo. Indica si está listo para firma.",
  args: { caso: nombreCaso },
  async run({ caso }, ctx) {
    const hoy = fechaEjecucion()
    const solicitud = await cargarSolicitud(ctx, caso)
    const exigidos = await cargarSoportesExigidos(ctx, caso)
    const maestro = await cargarMaestro(ctx)
    // Portal: no hay formulario que firmar, la analista carga todo en la web
    const esPortal = solicitud.formato === "portal"
    const etapa = esPortal ? "carga en portal" : "firma"

    // Plantilla dañada: se arma lo demás y se avisa
    let formulario: FormularioCreado | undefined
    let errorFormulario: string | undefined
    let mapeo: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] }
    try {
      const preparado = await prepararCaso(ctx, caso)
      mapeo = preparado.mapeo
      formulario = await crearFormulario(ctx, caso, preparado.datos, preparado.maestro, preparado.mapeo)
    } catch (e) {
      if (!(e instanceof ErrorHerramienta)) throw e
      errorFormulario = e.message
    }

    const soportes = await revisarSoportes(ctx, exigidos, hoy)

    // Vencido o ausente bloquea, un campo faltante no
    const bloqueos: string[] = []
    if (errorFormulario) bloqueos.push(`Formulario no generado: ${errorFormulario}`)
    for (const s of soportes) {
      if (s.estado === "vencido") bloqueos.push(`Soporte vencido: ${s.tipo} (venció el ${s.vigencia_hasta}).`)
      if (s.estado === "ausente") bloqueos.push(`Soporte ausente: ${s.tipo}.`)
    }
    const listo = bloqueos.length === 0

    // Carpeta del paquete limpia en cada ejecución
    const carpetaCaso = rutaOutCaso(ctx, caso)
    const carpetaPaquete = join(carpetaCaso, "paquete")
    await rm(carpetaPaquete, { recursive: true, force: true })
    await mkdir(carpetaPaquete, { recursive: true })

    if (formulario) await copyFile(join(carpetaCaso, formulario.archivo), join(carpetaPaquete, formulario.archivo))
    for (const s of soportes) {
      if (s.archivo && s.estado !== "ausente") {
        await copyFile(join(rutasBase(ctx).soportes, s.archivo), join(carpetaPaquete, s.archivo))
      }
    }

    // checklist.md
    const lineasSoportes = soportes.map((s) => {
      const marca = s.estado === "presente" ? "[x]" : "[ ]"
      return `- ${marca} ${s.tipo}: ${s.estado.toUpperCase()}. ${s.detalle}`
    })
    const lista = (items: string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- Ninguno")
    const lineasFormulario = !formulario
      ? [`- No generado: ${errorFormulario}`]
      : esPortal
        ? [
            `- Valores para copiar: ${formulario.archivo} (uso interno: puede incluir datos bancarios; no se envía al cliente).`,
            "- Formato no soportado: una persona entra al portal con las credenciales que recibió (no pasan por el agente) y hace clic en Enviar.",
          ]
        : [`- Generado: ${formulario.archivo}`]
    const checklist = [
      `# Checklist de ${etapa} - ${solicitud.cliente}`,
      "",
      `- Caso: ${caso}`,
      `- Fecha de ejecución: ${hoy}`,
      `- Estado: **${listo ? "LISTO" : "NO LISTO"} PARA ${etapa.toUpperCase()}**`,
      "",
      "## Formulario",
      ...lineasFormulario,
      "",
      "## Soportes",
      ...lineasSoportes,
      "",
      "## Campos faltantes (no bloquean la firma)",
      lista(mapeo.faltantes.map((f) => `${f.etiqueta}: ${f.motivo}`)),
      "",
      "## Campos por confirmar",
      lista(mapeo.requiere_confirmacion.map((c) => `${c.etiqueta}: ${c.nota}`)),
      "",
    ].join("\n")
    await writeFile(join(carpetaPaquete, "checklist.md"), checklist, "utf8")

    // borrador-correo.md (sin datos bancarios)
    const firmante = String(obtenerPorRuta(maestro, "representante_legal.nombre") ?? "")
    const cargo = String(obtenerPorRuta(maestro, "representante_legal.cargo") ?? "")
    const razonSocial = String(obtenerPorRuta(maestro, "razon_social") ?? "")
    // Portal: valores-portal.md es interno
    const soportesPresentes = soportes.filter((s) => s.estado === "presente").map((s) => s.archivo)
    const adjuntos = [esPortal ? undefined : formulario?.archivo, ...soportesPresentes].filter((a): a is string => Boolean(a))
    const aviso = [
      ...(listo ? [] : ["> BORRADOR INTERNO - NO ENVIAR. Pendiente:", ...bloqueos.map((b) => `> - ${b}`), ""]),
      ...(esPortal ? ["> Enviar solo después de que una persona complete el registro en el portal.", ""] : []),
    ]
    const presentacion = esPortal
      ? `Informamos que el registro de ${razonSocial} como proveedor de ${solicitud.cliente} fue diligenciado en su portal, con los siguientes soportes cargados:`
      : `Adjuntamos el formulario diligenciado para el registro de ${razonSocial} como proveedor de ${solicitud.cliente}, firmado por nuestro representante legal, ${firmante} (${cargo}), junto con los siguientes soportes:`
    const correo = [
      ...aviso,
      `Para: ${solicitud.de}`,
      `Asunto: RE: ${solicitud.asunto}`,
      "",
      "Buen día,",
      "",
      presentacion,
      "",
      ...adjuntos.map((a) => `- ${a}`),
      "",
      "Quedamos atentos a cualquier observación.",
      "",
      "Cordialmente,",
      `Área administrativa - ${razonSocial}`,
      "",
    ].join("\n")
    await writeFile(join(carpetaPaquete, "borrador-correo.md"), correo, "utf8")

    // Estado que lee simular_envio.
    await writeFile(join(carpetaCaso, "estado.json"), JSON.stringify({ listo_para_firma: listo, bloqueos, etapa, fecha: fechaEjecucion() }, null, 2), "utf8")

    return {
      data: {
        ruta: `out/${caso}/paquete/`,
        formato: solicitud.formato,
        listo_para_firma: listo,
        checklist: {
          fecha_ejecucion: hoy,
          formulario: formulario ? formulario.ruta : null,
          soportes,
          bloqueos,
          campos_faltantes: mapeo.faltantes.map((f) => f.etiqueta),
          campos_por_confirmar: mapeo.requiere_confirmacion.map((c) => ({ etiqueta: c.etiqueta, nota: c.nota })),
        },
      },
      resumen: `Paquete ${listo ? "listo" : "NO listo"} para ${etapa}; ${bloqueos.length} bloqueo(s).`,
    }
  },
})

// ---------- Herramienta 5 (simulación) ----------

export const simular_envio = definirHerramienta({
  nombre: "proveedor_simular_envio",
  description:
    "Simula el envío del paquete al cliente escribiendo out/<caso>/ENVIO-SIMULADO.md. Solo funciona con confirmado=true, que debe venir de una confirmación explícita del usuario en su mensaje inmediatamente anterior.",
  args: {
    caso: nombreCaso,
    confirmado: z
      .boolean()
      .describe("true solo si el usuario confirmó explícitamente el envío en su mensaje inmediatamente anterior"),
  },
  async run({ caso, confirmado }, ctx) {
    if (!confirmado) throw new ErrorHerramienta(MENSAJE_SIN_CONFIRMACION)

    const solicitud = await cargarSolicitud(ctx, caso)
    const carpetaCaso = rutaOutCaso(ctx, caso)
    if (!existsSync(join(carpetaCaso, "estado.json"))) {
      throw new ErrorHerramienta("Primero hay que armar el paquete (proveedor_armar_paquete).")
    }
    const estado = await leerJson(join(carpetaCaso, "estado.json"), EsquemaEstadoPaquete, `out/${caso}/estado.json`)

    // Se envían formulario y soportes
    const internos = ["checklist.md", "borrador-correo.md", "valores-portal.md"]
    const adjuntos = (await readdir(join(carpetaCaso, "paquete"))).filter((f) => !internos.includes(f)).sort()

    const contenido = [
      "# ENVIO SIMULADO",
      "",
      "> Simulación: no se envió ningún correo real.",
      "",
      `- Fecha de ejecución: ${fechaEjecucion()}`,
      `- Para: ${solicitud.de}`,
      `- Asunto: RE: ${solicitud.asunto}`,
      "- Adjuntos:",
      ...adjuntos.map((a) => `  - ${a}`),
      "",
      estado.listo_para_firma
        ? `Estado del paquete: listo para ${estado.etapa}.`
        : [`ADVERTENCIA: el paquete NO estaba listo para ${estado.etapa}. Pendiente:`, ...estado.bloqueos.map((b) => `- ${b}`)].join("\n"),
      "",
    ].join("\n")
    await writeFile(join(carpetaCaso, "ENVIO-SIMULADO.md"), contenido, "utf8")

    return { data: { ruta: `out/${caso}/ENVIO-SIMULADO.md` }, resumen: "Envío simulado escrito." }
  },
})