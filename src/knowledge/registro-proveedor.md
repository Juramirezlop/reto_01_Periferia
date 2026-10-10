# Conocimiento del proceso de registro

- Un caso es una solicitud de un cliente para registrar a Periferia como proveedor. Trae un formulario en formato xlsx, pdf o portal web.
- Los datos de la empresa salen del repositorio maestro; los documentos, del repositorio de soportes con su fecha de vigencia.
- Identificador tributario por país: Colombia NIT, Ecuador RUC, Perú RUC, Panamá RUC, Honduras RTN. Periferia solo tiene NIT colombiano: si un cliente extranjero pide otro identificador, es un dato por confirmar.
- Etiquetas ambiguas como "Identificación tributaria" o "Número de identificación fiscal" siempre requieren confirmación.
- Un soporte vencido o ausente bloquea el paquete; un campo faltante no.
- Si el formato es "portal", no se genera archivo: se entregan los valores listos para copiar y la etapa del paquete es "carga en portal" (no hay firma).
- Cada acción queda registrada en out/<caso>/log.jsonl.
