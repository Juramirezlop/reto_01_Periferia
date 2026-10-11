import { urlArchivo, type VistaCaso } from "./api"

// El valor se muestra tal como lo entrega el servidor (los datos bancarios ya vienen enmascarados).
const texto = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v))

export function Expediente({ caso, vista }: { caso: string; vista: VistaCaso }) {
  const { llenos, requiere_confirmacion: confirmar, faltantes } = vista.mapeo
  const total = llenos.length + confirmar.length + faltantes.length || 1
  const estado = vista.estado

  // Cada campo en el orden en que lo pide el cliente, con su estado.
  const filas = vista.solicitud.campos.map((c) => {
    const lleno = llenos.find((l) => l.etiqueta === c.etiqueta)
    const conf = confirmar.find((l) => l.etiqueta === c.etiqueta)
    const falta = faltantes.find((l) => l.etiqueta === c.etiqueta)
    if (lleno) return { c, tipo: "lleno", valor: texto(lleno.valor), nota: "" }
    if (conf) return { c, tipo: "confirmar", valor: texto(conf.valor), nota: conf.nota }
    return { c, tipo: "falta", valor: "—", nota: falta?.motivo ?? "" }
  })

  const sello = vista.obsoleto ? { clase: "sin-armar", texto: "Reprocesar" } : !estado ? { clase: "sin-armar", texto: "Paquete sin armar" } : estado.listo_para_firma ? { clase: "listo", texto: estado.etapa === "firma" ? "Listo para firma" : "Listo para portal" } : { clase: "bloqueado", texto: "Bloqueado" }

  return (
    <div className="expediente">
      <div className="cliente">
        <h2>{vista.solicitud.cliente}</h2>
        <p>{vista.solicitud.pais} · formato {vista.solicitud.formato}</p>
      </div>

      {/* key = clase: al cambiar de estado el sello se vuelve a estampar */}
      <div key={sello.clase + caso} className={`sello ${sello.clase}`}>{sello.texto}</div>

      {vista.obsoleto && <p className="aviso">Este estado se calculó con otra fecha de ejecución. Pídele al agente que procese el caso otra vez.</p>}

      <div className="barra-campos" role="img" aria-label={`${llenos.length} llenos, ${confirmar.length} por confirmar, ${faltantes.length} faltantes`}>
        <span className="b-lleno" style={{ flex: llenos.length }} />
        <span className="b-confirmar" style={{ flex: confirmar.length }} />
        <span className="b-falta" style={{ flex: faltantes.length }} />
      </div>
      <p className="conteo">{llenos.length} de {total} llenos · {confirmar.length} por confirmar · {faltantes.length} faltantes</p>

      <ul className="campos">
        {filas.map(({ c, tipo, valor, nota }) => (
          <li key={c.etiqueta} className={tipo}>
            <span className="icono" />
            <span className="etiqueta">{c.etiqueta}{c.obligatorio === false && <small> opcional</small>}</span>
            <span className="valor">{valor}</span>
            {nota && <span className="nota">{nota}</span>}
          </li>
        ))}
      </ul>

      <h3>Soportes exigidos</h3>
      <ul className="soportes">
        {vista.solicitud.soportes.map((s) => {
          const bloqueo = estado?.bloqueos.find((b) => b.includes(s))
          return (
            <li key={s} className={bloqueo ? "bloqueo" : estado ? "ok" : ""}>
              <span className="icono" />
              {s.replaceAll("_", " ")}
              {bloqueo && <span className="nota">{bloqueo}</span>}
            </li>
          )
        })}
      </ul>

      {estado && estado.bloqueos.some((b) => !vista.solicitud.soportes.some((s) => b.includes(s))) && (
        <ul className="soportes">
          {estado.bloqueos.filter((b) => !vista.solicitud.soportes.some((s) => b.includes(s))).map((b) => (
            <li key={b} className="bloqueo"><span className="icono" />{b}</li>
          ))}
        </ul>
      )}

      {vista.archivos.length > 0 && (
        <>
          <h3>Archivos del paquete</h3>
          <ul className="archivos">
            {vista.archivos.map((a) => (
              <li key={a}><a href={urlArchivo(caso, a)} download>{a}</a></li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
