import { createWriteStream } from "node:fs"
import { writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import type { Campo } from "./datos"
import type { Mapeo } from "./mapeo"

// Convierte un valor del maestro en lo que se escribe en el formulario.
export function textoValor(valor: unknown): string {
  if (valor === undefined || valor === null) return ""
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  if (Array.isArray(valor)) return valor.join(", ")
  return String(valor)
}

// ---------- Excel (P0) ----------

// Escribe cada etiqueta y su valor en la hoja y celda EXACTAS que indica la plantilla.
export async function generarXlsx(campos: Campo[], valores: Map<string, unknown>, ruta: string): Promise<void> {
  const libro = new ExcelJS.Workbook()

  for (const campo of campos) {
    if (!campo.hoja || !campo.celda_etiqueta || !campo.celda_valor) continue
    const hoja = libro.getWorksheet(campo.hoja) ?? libro.addWorksheet(campo.hoja)

    const celdaEtiqueta = hoja.getCell(campo.celda_etiqueta)
    celdaEtiqueta.value = campo.etiqueta
    celdaEtiqueta.font = { bold: true }

    // Los números se escriben como número; lo demás como texto. Sin valor: celda vacía.
    const valor = valores.get(campo.etiqueta)
    hoja.getCell(campo.celda_valor).value = typeof valor === "number" ? valor : textoValor(valor) || null

    // Ancho de columnas: la letra es lo que va antes del número (B3 -> B).
    hoja.getColumn(campo.celda_etiqueta.replace(/\d+/g, "")).width = 34
    hoja.getColumn(campo.celda_valor.replace(/\d+/g, "")).width = 48
  }

  await libro.xlsx.writeFile(ruta)
}

// ---------- PDF (P1) ----------

// PDF generado (no AcroForm): una línea por campo, en el orden de la plantilla.
export function generarPdf(
  titulo: string,
  campos: Campo[],
  valores: Map<string, unknown>,
  firmante: string,
  ruta: string,
): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const doc = new PDFDocument({ margin: 50 })
    const salida = createWriteStream(ruta)
    salida.on("finish", () => resolver())
    salida.on("error", rechazar)
    doc.pipe(salida)

    doc.font("Helvetica-Bold").fontSize(16).text(titulo)
    doc.moveDown()

    for (const campo of campos) {
      const texto = textoValor(valores.get(campo.etiqueta))
      doc.font("Helvetica-Bold").fontSize(10).text(campo.etiqueta + (campo.obligatorio ? " *" : ""))
      doc.font("Helvetica").fontSize(11).text(texto || "— (pendiente)", { indent: 12 })
      doc.moveDown(0.6)
    }

    doc.moveDown(2)
    doc.font("Helvetica").fontSize(10).text("______________________________")
    doc.text(`Firma del representante legal: ${firmante}`)
    doc.end()
  })
}

// ---------- Portal web (P2): no se automatiza, solo se dejan los valores para copiar ----------

export async function generarValoresPortal(
  cliente: string,
  campos: Campo[],
  mapeo: Mapeo,
  valores: Map<string, unknown>,
  ruta: string,
): Promise<void> {
  const celda = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const notas = new Map(mapeo.requiere_confirmacion.map((c) => [c.etiqueta, c.nota]))
  const motivos = new Map(mapeo.faltantes.map((f) => [f.etiqueta, f.motivo]))

  const filas = campos.map((campo) => {
    const valor = textoValor(valores.get(campo.etiqueta))
    const estado = notas.has(campo.etiqueta)
      ? `Confirmar: ${notas.get(campo.etiqueta)}`
      : motivos.has(campo.etiqueta)
        ? `Faltante: ${motivos.get(campo.etiqueta)}`
        : "Listo"
    return `| ${celda(campo.etiqueta)} | ${celda(valor)} | ${celda(estado)} |`
  })

  const contenido = [
    `# Valores para el portal de ${cliente}`,
    "",
    "Formato no soportado: el portal web lo opera una persona (usuario, contraseña y clic en Enviar).",
    "Estos son los valores listos para copiar y pegar.",
    "",
    "| Campo | Valor | Estado |",
    "|---|---|---|",
    ...filas,
    "",
  ].join("\n")

  await writeFile(ruta, contenido, "utf8")
}
