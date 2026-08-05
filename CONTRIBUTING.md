# Contribuir

1. Usa Node.js 20 o posterior y ejecuta `npm ci`.
2. Trabaja únicamente con fixtures sanitizados; nunca agregues respuestas HTML,
   identificadores, notas, documentos, cookies o credenciales reales.
3. Mantén herramientas explícitas y esquemas cerrados. Cualquier nueva escritura
   requiere vista previa, confirmación inequívoca y conciliación posterior.
4. Ejecuta `npm test` y `npm run doctor` antes de proponer un cambio.
5. Actualiza los contratos con
   `npm run tool-contracts -- --output integrations/tool-contracts` cuando cambie
   una herramienta.

Los cambios en parsers deben incluir fixtures ficticios y pruebas de regresión.
Los cambios que dependan de una vista nueva de PUCP deben indicar qué partes se
verificaron en vivo y cuáles son solo compatibilidad anticipada.
