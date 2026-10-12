---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor: reglas por país, soportes, formatos (Excel, PDF, portal) y quién hace qué. Úsalo al procesar o explicar un caso.
---
# Conocimiento del proceso de registro

## Qué es un caso

Un caso es una solicitud de un cliente para registrar a Periferia como proveedor, este trae un formulario en formato xlsx, pdf o portal web, los datos de la empresa salen del repositorio maestro; los documentos, del repositorio de soportes con su fecha de vigencia.

## Reglas del proceso

- Identificador tributario por país: Colombia NIT, Ecuador RUC, Perú RUC, Panamá RUC, Honduras RTN. Periferia solo tiene NIT colombiano: si un cliente extranjero pide otro identificador, el campo se llena con el NIT y queda por confirmar con la nota "identificador extranjero".
- Etiquetas ambiguas como "Identificación tributaria" o "Número de identificación fiscal" siempre requieren confirmación.
- Un soporte vencido o ausente bloquea el paquete; un campo faltante no.
- Cada acción queda registrada en out/<caso></caso>/log.jsonl.
- Enviar siempre es una decisión de la analista, en este sistema "enviar" solo escribe out/<caso></caso>/ENVIO-SIMULADO.md.

## Casos en Excel o PDF

El agente genera el formulario lleno (formulario.xlsx o formulario.pdf) y arma el paquete en out/<caso></caso>/paquete/ con el formulario, los soportes, checklist.md y borrador-correo.md. Si está listo para firma, la analista lo revisa y se lo pasa al representante legal, luego de esto lo envía al cliente.

## Casos de portal web

El sistema no llena portales, unicamente responde "formato no soportado" y deja los valores listos para copiar en out/<caso></caso>/valores-portal.md, el paquete queda en etapa "carga en portal" (no hay firma). 

Pasos para la analista:

1. Procesar el caso y revisar los campos por confirmar y los faltantes.
2. Actualizar los soportes vencidos o ausentes y volver a procesar.
3. Abrir el portal del cliente con sus propias credenciales. El agente nunca las ve ni las pide.
4. Copiar los valores desde valores-portal.md (también se descarga desde el panel Expediente) y subir los soportes del paquete cuando el portal los pida.
5. Revisar todo y hacer clic en "Enviar" ella misma., ese clic nunca lo da el agente.
   Los datos bancarios aparecen en valores-portal.md solo si el portal los pide, y nunca se copian a correos ni al chat.
