import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import type { VistaCaso } from "./api"
import { Frontera } from "./Frontera"

export type Mensaje = { rol: "usuario" | "agente"; texto: string; herramientas?: { nombre: string; ok: boolean }[]; error?: boolean }

// Ondas concéntricas: el único adorno, solo se ve con el chat vacío.
function Ondas() {
  return (
    <svg className="ondas" viewBox="0 0 200 120" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <ellipse key={i} cx="100" cy="60" rx={14 + i * 11} ry={6 + i * 6.5} transform={`rotate(${-12 + i * 2.5} 100 60)`} />
      ))}
      <circle cx="100" cy="60" r="3" className="relleno" />
    </svg>
  )
}

export function Chat(props: {
  mensajes: Mensaje[]
  trabajando: boolean
  caso: string | null
  vista?: VistaCaso
  onEnviar: (texto: string) => void
}) {
  const [texto, setTexto] = useState("")
  const fin = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Con llaves: un efecto no debe devolver nada (si devuelve algo que no es una función, React falla).
    fin.current?.scrollIntoView({ behavior: "smooth" })
  }, [props.mensajes, props.trabajando])

  // Atajos según el caso elegido. "Confirmar envío" solo se habilita si el paquete está listo.
  const listo = props.vista?.estado?.listo_para_firma === true
  const atajos = props.caso
    ? [
        { texto: "Procesar este caso", mensaje: `Procesa el caso "${props.caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`, activo: true },
        { texto: "¿Qué soportes faltan?", mensaje: `Del caso "${props.caso}", ¿qué soportes están vencidos o ausentes?`, activo: true },
        { texto: "Confirmo el envío", mensaje: `Confirmo el envío del caso "${props.caso}".`, activo: listo },
      ]
    : []

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    const limpio = texto.trim()
    if (!limpio || props.trabajando) return
    props.onEnviar(limpio)
    setTexto("")
  }

  return (
    <div className="chat">
      <div className="mensajes" aria-live="polite">
        {props.mensajes.length === 0 && (
          <div className="inicio">
            <Ondas />
            <p>Elige un caso y pídeme que lo procese. No envío nada sin tu confirmación.</p>
          </div>
        )}
        {props.mensajes.map((m, i) => (
          <article key={i} className={`mensaje ${m.rol}${m.error ? " error" : ""}`}>
            {m.rol === "agente" ? (
              // Si el formato Markdown fallara con algún texto, se muestra tal cual.
              <Frontera alternativa={() => <p style={{ whiteSpace: "pre-wrap" }}>{m.texto}</p>}>
                <Markdown>{m.texto}</Markdown>
              </Frontera>
            ) : (
              <p>{m.texto}</p>
            )}
            {m.herramientas && m.herramientas.length > 0 && (
              <ol className="traza">
                {m.herramientas.map((h, j) => (
                  <li key={j} className={h.ok ? "ok" : "falla"} style={{ animationDelay: `${j * 90}ms` }}>
                    {h.nombre.replace("proveedor_", "")}
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}
        {props.trabajando && (
          <article className="mensaje agente trabajando">
            <span className="cursor" /> consultando herramientas…
          </article>
        )}
        <div ref={fin} />
      </div>

      <div className="atajos">
        {atajos.map((a) => (
          <button key={a.texto} disabled={!a.activo || props.trabajando} onClick={() => props.onEnviar(a.mensaje)} title={a.activo ? "" : "Disponible cuando el paquete esté listo para firma"}>
            {a.texto}
          </button>
        ))}
      </div>

      <form className="entrada" onSubmit={enviar}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe tu mensaje…" aria-label="Mensaje" />
        <button type="submit" disabled={props.trabajando || !texto.trim()}>Enviar ↗</button>
      </form>
    </div>
  )
}
