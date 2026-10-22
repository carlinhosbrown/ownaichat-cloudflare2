# Validación de OwnAIChat 0.2.0

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
- `npm run check`: correcto; sintaxis del Worker, Access, frontend, Service Worker y scripts.
- `npm test`: **35 pruebas, 35 correctas, 0 fallos, 0 omitidas**. Incluye pruebas principales y subpruebas.
- `npm run db:local`: migración inicial aplicada correctamente (12 instrucciones). Segunda ejecución: ninguna migración pendiente.
- `npm run deploy:dry`: correcto; Worker empaquetado y 9 archivos estáticos detectados. Bindings enumerados: `DB`, `ASSETS`, `FILES_ENABLED="false"`, `ACCESS_ENABLED="false"`. Ningún binding R2, Access, KV, Durable Objects ni Secrets Store.
- `npm audit`: 0 vulnerabilidades conocidas en las dependencias fijadas, incluidas las de desarrollo, en el momento de la consulta. No equivale a una auditoría completa de seguridad.
- Comprobación en navegador contra Wrangler local: pantalla inicial, bootstrap local con datos ficticios, acceso con contraseña, creación de proyecto e instrucciones, persistencia tras recargar y ausencia del botón de subida con R2 desactivado.
- Respuesta HTTP real del servidor local: shell 200 y cabecera Content-Security-Policy presente.

## Cobertura funcional

1. Arranque sin R2, Access ni bindings opcionales; contraseña obligatoria para acceder a datos.
2. Secretos vacíos, marcadores o iguales mantienen bloqueada la instalación. Token, contraseña mínima, protección de origen, propietario único y cookies seguras.
3. Eliminación de BOOTSTRAP_TOKEN tras instalar sin perder login ni sesiones. Logout y limitación básica de intentos.
4. D1: proyectos, chats, instrucciones, mensajes y lectura del mismo historial desde dos sesiones independientes. Exportación sin claves.
5. Los cuatro conectores con respuestas simuladas: endpoint, autenticación, modelo, contexto de instrucciones, streaming y persistencia. Cifrado de claves y rechazo de endpoints no autorizados.
6. Adjuntos desactivados: error 409 antes de leer multipart; flag activado sin binding: error 503 y chats operativos.
7. R2 local opcional: subida, descarga autenticada, texto extraído, MIME/tamaño, borrado, conservación de objetos/metadatos con el flag desactivado y recuperación al reactivarlo.
8. Access opcional: JWT RS256 firmado, emisor, audiencia, caducidad, `nbf`, manipulación, algoritmo no admitido, claves desconocidas, configuración incompleta, fallos y redirecciones de JWKS. Comprobación en shell estático y API, manteniendo contraseña adicional.
9. Migración idempotente con datos existentes y borrado de proyectos sin pérdida de conversaciones.
10. Scripts: secretos aleatorios diferentes, permisos locales privados, rechazo de sobrescritura y generación del enlace Deploy to Cloudflare.

## Comprobaciones pendientes en servicios reales

No se ha iniciado sesión en una cuenta Cloudflare, aprovisionado D1 remoto, activado R2/Access, publicado un repositorio ni desplegado el Worker. No se ha pulsado el botón con un repositorio público real.

El enlace incluido en el README es una plantilla que necesita la URL del repositorio público donde publiques el código. El comando de deploy y los bindings están preparados conforme a la documentación oficial; el aprovisionamiento, la presentación de secretos en el formulario, los permisos de Workers Builds y el primer deploy remoto deben verificarse en esa cuenta.

Los proveedores de IA y JWKS se simulan durante las pruebas. No se han probado modelos ni cuentas de pago reales. El simulador local tampoco certifica el límite real de CPU del plan Workers Free ni el comportamiento bajo carga.

Los secretos y datos ficticios creados para las pruebas locales se excluyen del ZIP, junto con `node_modules`, `.wrangler`, cachés y archivos personales. El ZIP contiene el código completo, documentación, pruebas, dependencias fijadas y esquema D1; no contiene las dependencias instaladas.
