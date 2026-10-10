import type { ReactNode } from "react"

// Marco común: barra negra con título y, a la derecha, los botones de la ventana.
export function Ventana(props: { titulo: string; clase: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className={`ventana ${props.clase}`}>
      <div className="barra">
        <span className="titulo">{props.titulo}</span>
        <span className="acciones">{props.acciones}</span>
      </div>
      <div className="cuerpo">{props.children}</div>
    </section>
  )
}
