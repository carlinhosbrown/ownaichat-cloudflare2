# Validación de OwnAIChat 0.4.0

Fecha de entrega: 22 de octubre de 2026 (Europe/Madrid).

## Procedencia

Se ha modificado el código del ZIP original localizado en Descargas: `ownchat-cloudflare-mvp.zip`, no se ha reconstruido otro proyecto desde cero.

SHA-256 del ZIP de origen:

```text
eefb464f7611d76f14af484303b86c9dd4fde85df6d790ef0ff4ed33decfcc1e
```

El esquema `migrations/0001_initial.sql` coincide byte a byte con el MVP. SHA-256 de ambas versiones:

```text
d4cc4a70e4a1fea171cea4ca38e0ed7397a8f6b806f5c1d73f2b183fc57969a8
```

## Entorno y resultados

- macOS ARM64; Node.js 24.14.1; npm 11.12.1.
- Wrangler 4.151.3 y Miniflare 5.20261019.1-beta, la misma versión de simulador usada por ese Wrangler. Versiones fijadas y dependencias reproducibles mediante `package-lock.json`.
- `npm run check`: correcto; incluye conexiones, imágenes, errores, modos, Worker, Access, frontend, PWA y scripts.
- `npm test`: **77 pruebas, 77 correctas, 0 fallos, 0 omitidas**. Incluye pruebas principales y subpruebas.
- `npm run db:local`: 0002 aplicada sobre la base local anterior, 8 instrucciones. Segunda ejecución: ninguna migración pendiente. 0001 permanece idéntica al MVP.
- `npm run deploy:dry`: empaquetado local correcto, 11 archivos estáticos. Bindings: `DB`, `ASSETS`, `FILES_ENABLED="false"`, `ACCESS_ENABLED="false"`. No se añade ningún servicio obligatorio.
- Las versiones de dependencias no cambian respecto a 0.3; no se ha repetido `npm audit` para 0.4. El resultado de la consulta de 0.2/0.3 fue 0 avisos conocidos en ese momento, no una auditoría completa de seguridad.
- Navegador 0.4 contra backend workerd/Miniflare: login, DeepSeek Pro + esfuerzo máximo, OpenAI GPT-5.4 + muy alto, streaming simulado y distintivos de modo.
- Cambio a imagen desde texto, modelo GPT Image seleccionado, calidad/tamaño, respuesta simulada y vista previa privada descargada por el navegador. La imagen del simulador es un PNG de prueba de 1 píxel, no una generación real.
- Formulario custom: alta de RunPod Serverless vLLM con clave ficticia, aparición en el selector, chat simulado y recuperación de conexión/modo/historial/imagen tras recargar y reabrir el chat. Sin errores de consola en esa comprobación.
- Las comprobaciones de bootstrap y proyectos en navegador se realizaron en la entrega 0.2; sus pruebas automatizadas vuelven a pasar en 0.4. No se ha repetido aquí un despliegue real.

## Cobertura funcional

1. Arranque sin R2, Access ni bindings opcionales; contraseña obligatoria para acceder a datos.
2. Secretos vacíos, marcadores o iguales mantienen bloqueada la instalación. Token, contraseña mínima, protección de origen, propietario único y cookies seguras.
3. Eliminación de BOOTSTRAP_TOKEN tras instalar sin perder login ni sesiones. Logout y limitación básica de intentos.
4. D1: proyectos, chats, instrucciones, mensajes y lectura del mismo historial desde dos sesiones independientes. Exportación sin claves.
5. Los cuatro conectores con respuestas simuladas: endpoint, autenticación, modelo, contexto de instrucciones, streaming y persistencia. Cifrado de claves y rechazo de endpoints no autorizados.
6. Adjuntos desactivados: error 409 antes de leer multipart; flag activado sin binding: error 503 y chats operativos.
7. R2 local opcional: subida, descarga autenticada, texto extraído, MIME/tamaño, borrado, conservación de objetos/metadatos con el flag desactivado y recuperación al reactivarlo.
8. Access opcional: JWT RS256 firmado, emisor, audiencia, caducidad, `nbf`, manipulación, algoritmo no admitido, claves desconocidas, configuración incompleta, fallos y redirecciones de JWKS. Comprobación en shell estático y API, manteniendo contraseña adicional.
9. Migraciones registradas y aplicadas una vez, conservando propietario, claves, proyectos e historial anterior. Borrado de proyectos sin pérdida de conversaciones.
10. Scripts: secretos aleatorios diferentes, permisos locales privados, rechazo de sobrescritura y generación del enlace Deploy to Cloudflare.
11. Catálogos de modelos autenticados de los cuatro proveedores, paginación, nombres, filtrado, resultados repetidos o inválidos y límites. Fallos 401/403/429/503, redirecciones y JSON inválido conservan las sugerencias y no devuelven claves al navegador.
12. Envío exacto de DeepSeek Flash, Pro e ID manual; persistencia del modelo en el chat y acceso desde una segunda sesión. Valores predeterminados distintos para DeepSeek y OpenAI.
13. Modos y esfuerzos compartidos por UI/Worker; campos nativos correctos por proveedor, rechazo previo de combinaciones inválidas, cambio de modelo sin arrastrar opciones incompatibles y persistencia entre sesiones.
14. Custom: autenticación/origen, destinos HTTPS, IPs/localhost/metadata y URLs mal formadas, RunPod Serverless/Pod, cifrado y separación de claves, edición/rotación, cambio de URL, catálogo ausente, sin clave, redirecciones y eliminación sin perder chats.
15. Imágenes: OpenAI sin response_format, Gemini nativo sin bloques thought, custom con URL sin reenviar Authorization, descarga autenticada sin caché, metadatos sin binarios en exportación, errores, límites, formatos no permitidos y cascadas.
16. Reconstrucción de datos fragmentados, incluida una imagen sintética de 6 MiB guardada en 35 fragmentos de hasta 240000 caracteres. No certifica el presupuesto real de CPU o las cuotas del plan Free.

## Comprobaciones pendientes en servicios reales

El usuario ha comunicado que su instalación anterior funciona. En esta entrega no se ha accedido a su cuenta Cloudflare, aprovisionado D1 remoto, activado R2/Access, publicado su repositorio ni desplegado el Worker. Tampoco se ha accedido a cuentas RunPod o proveedores IA. Modos, conexiones y generación se comprueban con respuestas simuladas; no hay imagen generada ni tokens/GPU consumidos en un servicio real.

El enlace incluido en el README es una plantilla que necesita la URL del repositorio público donde publiques el código. El comando de deploy y los bindings están preparados conforme a la documentación oficial; el aprovisionamiento, la presentación de secretos en el formulario, los permisos de Workers Builds y el primer deploy remoto deben verificarse en esa cuenta.

Los proveedores de IA y JWKS se simulan durante las pruebas. No se han probado modelos ni cuentas de pago reales. El simulador local tampoco certifica el límite real de CPU del plan Workers Free ni el comportamiento bajo carga.

Los secretos y datos ficticios creados para las pruebas locales se excluyen del ZIP, junto con `node_modules`, `.wrangler`, cachés y archivos personales. El ZIP contiene el código completo, documentación, pruebas, dependencias fijadas y esquema D1; no contiene las dependencias instaladas.
