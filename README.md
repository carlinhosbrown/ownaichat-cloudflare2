# OwnAIChat 0.2 — tu IA privada en Cloudflare

Continuación del MVP OwnChat 0.1, conservando su interfaz, tablas D1, contraseña, cookies de sesión y conectores. Una cuenta privada por instalación; sin registro público.

**Configuración predeterminada: Workers + Static Assets + D1. R2 y Cloudflare Access están desactivados y no se aprovisionan.** Puedes usar el plan Workers Free y D1 dentro de sus cuotas, sin suscribirte a R2 ni configurar Zero Trust/Access. Las APIs de IA son servicios independientes: sus proveedores pueden cobrar por el uso.

Esta entrega incluye pruebas locales. No se ha desplegado ni verificado en una cuenta Cloudflare real. El aprovisionamiento mediante el botón y los límites reales de CPU del plan Free requieren esa comprobación antes del uso en producción.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/carlinhosbrown/ownaichat)

**El enlace anterior es una plantilla.** El ZIP no tiene un repositorio público asociado. Antes de usar o compartir el botón, sube el contenido de esta carpeta a un repositorio público de GitHub o GitLab y sustituye su URL:

```sh
npm run deploy:button -- https://github.com/TU_USUARIO/TU_REPOSITORIO
```

Usa aquí tu URL real, sin marcadores. Este comando solo actualiza el botón del README; no publica ni despliega nada. También puedes editar el enlace a mano. Cloudflare exige un repositorio público para este flujo, no un ZIP ni una dirección ficticia.

1. Publica los archivos, incluido `package-lock.json`, `wrangler.jsonc`, `.dev.vars.example` y `migrations/`, en la raíz del repositorio público.
2. Pulsa el botón configurado. El flujo debería detectar solo el Worker, Static Assets y la base D1 `DB`. Si aparece una solicitud de R2, revisa que estés utilizando esta versión sin `r2_buckets` en la configuración principal. No hace falta activar Access.
3. Usa Node.js 22.13 o superior, instalación `npm ci`, y **deploy `npm run deploy`** en Workers Builds. El deploy ejecuta `wrangler d1 migrations apply DB --remote` antes de `wrangler deploy`. El nombre de binding `DB`, en lugar del nombre físico de la base, permite que Cloudflare personalice el recurso durante la instalación.
4. Cloudflare lee `.dev.vars.example` para solicitar los secretos. Genera dos valores privados y diferentes con `npm run secrets:generate` o ejecutando **dos veces** `openssl rand -hex 32`. Introduce un resultado como `BOOTSTRAP_TOKEN` y el otro como `VAULT_KEY`. Guárdalos como secretos del Worker, nunca como variables del frontend ni en el repositorio. Si no se solicitaron en el flujo, añádelos en Workers & Pages → tu Worker → Settings → Variables and Secrets, y despliega los cambios.
5. Abre la URL del Worker, introduce tu token de instalación y crea una contraseña de 12–128 caracteres. Sin secretos válidos la instalación permanece bloqueada; no existe una cuenta ni contraseña predeterminada.
6. Añade las API Keys desde Configuración. Elige un identificador de modelo habilitado en tu cuenta de DeepSeek, OpenAI, Gemini o Anthropic.
7. Después de crear la cuenta puedes eliminar `BOOTSTRAP_TOKEN` de los secretos del Worker. Conserva **la misma `VAULT_KEY`**: sigue siendo necesaria para iniciar sesión y descifrar las API Keys.

El UUID `00000000-0000-0000-0000-000000000000` es un marcador para la plantilla; el flujo del botón debe reemplazarlo por el D1 creado antes de ejecutar las migraciones. Para despliegue manual debes sustituirlo tú. No existe aprovisionamiento automático de R2 por parte de la aplicación.

Referencias oficiales: [botón y aprovisionamiento](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [configuración de Assets](https://developers.cloudflare.com/workers/static-assets/binding/), [secretos](https://developers.cloudflare.com/workers/configuration/secrets/).

## Qué funciona sin R2 ni Access

- Inicio de sesión privado por contraseña, sesiones HttpOnly, Secure en producción y SameSite=Strict; protección de origen y limitación básica de intentos.
- Chats, instrucciones de proyectos y mensajes almacenados en D1; streaming SSE de las respuestas.
- El mismo historial desde dispositivos diferentes al iniciar sesión en la **misma URL**. La interfaz consulta D1 al volver a la ventana o pestaña; también puedes recargarla. No utiliza WebSockets ni una sincronización continua en segundo plano.
- DeepSeek, OpenAI, Gemini y Anthropic con endpoints oficiales fijos. Claves cifradas en D1 mediante AES-256-GCM, sin devolverlas al navegador.
- Exportación JSON de proyectos, chats, mensajes y metadatos de archivos; sin API Keys ni archivos binarios.
- PWA responsive con caché de recursos estáticos, nunca de respuestas API ni conversaciones. El uso de los chats requiere conexión.

Los proyectos **no necesitan archivos**. Con los adjuntos desactivados, el botón de subida se oculta y se muestra una explicación. No se exige Access en ninguna ruta en la configuración inicial.

## Desarrollo local sin servicios de pago

Requisito: Node.js 22.13+ (se recomienda una versión LTS compatible).

```sh
npm ci
npm run secrets:local
npm run db:local
npm run dev
```

`secrets:local` genera dos valores aleatorios en `.dev.vars` con permisos privados donde el sistema lo permite y **rechaza sobrescribir** un archivo existente. `.dev.vars` está excluido de Git. Alternativamente copia `.dev.vars.example` y completa sus valores; los valores vacíos no habilitan la cuenta.

La base y los archivos opcionales se emulan localmente: no necesitas una cuenta Cloudflare, activar R2 ni crear recursos remotos para probar este modo. En ciertos entornos restringidos el simulador necesita permiso para abrir puertos locales.

## Despliegue manual

```sh
npm ci
npx wrangler login
npx wrangler d1 create ownchat-db
```

Pon el ID devuelto en `d1_databases[0].database_id` de `wrangler.jsonc`. Después:

```sh
npm run deploy
npx wrangler secret put BOOTSTRAP_TOKEN
npx wrangler secret put VAULT_KEY
```

Cada `secret put` solicita el valor de forma interactiva. Si el primer deploy no tiene secretos, la API privada seguirá bloqueada hasta que los configures. No ejecutes comandos de creación de buckets ni actives Zero Trust para esta instalación básica.

`npm run deploy:dry` solo valida y empaqueta el Worker y Assets localmente. No ejecuta migraciones remotas ni publica recursos.

## Actualizar una instalación OwnChat existente

1. Haz una copia de D1 y conserva `VAULT_KEY`. Si utilizabas adjuntos, conserva también el bucket original. No publiques las copias.
2. Sustituye el código y **mantén el nombre real de tu Worker, su `database_id` y nombre de D1** en la configuración. El nombre de Worker predeterminado sigue siendo `ownchat-cloudflare` para facilitar la actualización; la marca visible pasa a OwnAIChat.
3. Mantén el mismo secreto `VAULT_KEY`: cambiarlo impide comprobar la contraseña anterior y descifrar las claves. Se conservan el formato de contraseñas, las cookies `ownchat_session`/`__Host-ownchat_session` y las tablas del MVP.
4. El esquema `0001_initial.sql` no cambia ni depende de R2/Access; no hay una migración destructiva ni una base nueva. `npm run deploy` aplica solo migraciones pendientes mediante el registro de Wrangler.
5. Si quieres continuar usando archivos, configura la opción R2 antes de desplegar. Si la desactivas, los objetos no se borran: D1 conserva los metadatos y los proyectos/chats siguen disponibles. Rehabilita el binding al **bucket original** para recuperar las descargas.

No borres D1, la tabla `owner`, los secretos ni el bucket para actualizar. El cambio de marca mantiene las preferencias locales del navegador. La nueva versión del Service Worker sustituye la caché estática anterior.

## R2 opcional: activar adjuntos expresamente

La configuración principal no tiene `r2_buckets`. **Tanto `FILES_ENABLED="true"` como un binding `FILES` son necesarios**. Un bucket vinculado con el flag ausente o en `"false"` no habilita los archivos.

Si decides habilitarlo, revisa las condiciones vigentes de R2 en tu cuenta; este paso opcional puede solicitar activar su facturación. Crea un bucket privado y añade al nivel superior de `wrangler.jsonc`:

```json
"r2_buckets": [
  {"binding": "FILES", "bucket_name": "TU_BUCKET_PRIVADO"}
]
```

Añade la coma de separación correspondiente y cambia **solo** `vars.FILES_ENABLED` a `"true"`. Conserva `ACCESS_ENABLED="false"` si no necesitas Access. Despliega de nuevo con `npm run deploy`. No publiques el bucket con `r2.dev` ni un dominio público.

- Admitidos: `.txt`, `.md`, `.csv`, `.json`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`; máximo 3 MB por archivo.
- Texto de hasta 200 KB: extracción acotada y contexto de proyecto limitado. PDF e imágenes se almacenan y descargan, sin OCR, extracción PDF ni uso multimodal.
- Descargas y borrados requieren la sesión privada y, si se habilita, un JWT de Access válido.
- Con R2 desactivado, subir/descargar/borrar archivos devuelve **409 `ATTACHMENTS_DISABLED`** con explicación. Con el flag activado pero sin binding devuelve **503 `R2_NOT_CONFIGURED`**; el resto de la aplicación continúa funcionando.
- Al desactivar R2 se conserva el listado de archivos anteriores como metadatos, con sus acciones deshabilitadas. Su texto no se añade al contexto del modelo mientras R2 no esté disponible.
- Borrar un proyecto sin archivos funciona sin R2 y mantiene sus chats desvinculados. Si conserva archivos y R2 no está disponible, devuelve **409 `ATTACHMENTS_IN_USE`** sin borrar datos; rehabilita su bucket original para eliminarlos de forma coherente.
- Borrar un proyecto con archivos y R2 habilitado elimina sus objetos y filas dependientes, hasta 500 archivos por operación como en el MVP.

Para desactivar adjuntos cambia el flag a `"false"` y elimina el binding de la configuración. La aplicación no elimina por ello el bucket remoto ni los objetos existentes. Desactivar solo el flag conserva el binding pero impide usarlo.

## Cloudflare Access opcional: segunda capa

Access está desactivado por defecto. No hace falta activar una organización de Zero Trust. La contraseña de OwnAIChat permanece obligatoria al habilitarlo.

Si lo deseas, crea una aplicación HTTP de Access y una política para tu dominio. En `vars` configura:

```json
"ACCESS_ENABLED": "true",
"ACCESS_TEAM_DOMAIN": "tu-equipo.cloudflareaccess.com",
"ACCESS_AUD": "AUD_DE_TU_APLICACION"
```

`ACCESS_TEAM_DOMAIN` es solo el hostname, sin `https://`, rutas ni barra final. La audiencia es la etiqueta AUD de esa aplicación, no un Client ID ni un secreto. Estas dos variables no son credenciales.

El Worker valida el header `Cf-Access-Jwt-Assertion`: firma RS256, clave de la organización, emisor, audiencia, expiración y `nbf` cuando existe. Las claves públicas se obtienen únicamente del dominio de equipo permitido, se cachean cinco minutos y las peticiones tienen un timeout. No basta con presentar un header o una dirección de correo.

`assets.run_worker_first=true` se conserva para que la comprobación también proteja la página y los estáticos. Las URLs alternativas `workers.dev` y de preview también pasan por ella: sin el JWT correcto se deniega el acceso. La app no crea una política de Access ni redirige por sí sola al proveedor de identidad; utiliza el dominio protegido configurado en Cloudflare.

Configuración incompleta: **503 `ACCESS_NOT_CONFIGURED`**. JWT ausente/inválido: **403 `ACCESS_REQUIRED`**. Fallo al obtener las claves: **503 `ACCESS_KEYS_UNAVAILABLE`**. No se omite la validación ante errores. Para volver al modo contraseña cambia `ACCESS_ENABLED` a `"false"`; elimina también la política externa si ya no quieres que Cloudflare intercepte tu dominio.

Referencia: [validación oficial de JWT de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Seguridad y límites

`BOOTSTRAP_TOKEN` solo permite crear la primera cuenta; se limita el número de intentos y una inserción atómica impide dos propietarios. Los secretos vacíos, marcadores de ejemplo, claves repetitivas y dos valores iguales mantienen la instalación bloqueada. Genera valores aleatorios; no reutilices tu contraseña como secreto. Retira el token después de instalar y conserva una copia segura de `VAULT_KEY`.

La contraseña usa el esquema PBKDF2 con sal y HMAC del MVP, compatible con los datos anteriores. No hay recuperación ni cambio de contraseña en esta versión. La protección por IP es básica. Las conversaciones de D1 no tienen cifrado extremo a extremo. Al llamar a un modelo, el contenido se envía al proveedor que elijas.

La app no requiere servicios Cloudflare de pago en su configuración inicial. Esto no significa uso ilimitado: Workers Free y D1 aplican cuotas. Como `run_worker_first=true`, las solicitudes a estáticos también invocan el Worker y consumen su cuota de solicitudes. No se activa un plan de pago automáticamente desde este código. El presupuesto real de CPU, especialmente en autenticación y streaming, debe comprobarse en una cuenta Free; el simulador no certifica ese límite. Las APIs de modelos pueden tener su propia facturación.

Consulta las condiciones vigentes: [Workers Free y límites](https://developers.cloudflare.com/workers/platform/limits/), [coste de Static Assets y worker-first](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1](https://developers.cloudflare.com/d1/platform/pricing/). La exportación JSON no sustituye las copias completas de D1, objetos y secretos.

## Pruebas reproducibles

```sh
npm ci
npm run check
npm test
npm run db:local
npm run deploy:dry
```

Las pruebas ejecutan el Worker en workerd/Miniflare con D1 SQLite real emulado y R2 local cuando se solicita. Las respuestas de los cuatro proveedores y las claves públicas de Access se simulan: no llaman a proveedores reales ni consumen tokens.

Se comprueban la configuración sin servicios opcionales, bootstrap cerrado, secretos, cookies, protección de origen, login/logout, limitación de intentos, proyectos, persistencia multidispositivo, exportación, claves cifradas, streaming de los cuatro conectores, límites y disponibilidad de adjuntos, conservación de datos antiguos, migraciones repetibles y JWT firmados/inválidos de Access en API y estáticos. También se prueban los scripts de generación de secretos y configuración del botón.

El archivo `VALIDATION.md` registra los resultados de esta entrega y diferencia las pruebas locales de los pasos no realizados en Cloudflare.

## Archivos principales

```text
public/                  Interfaz, estilos, PWA y cabeceras
src/worker.js            Contraseña, sesiones, D1, archivos y conectores
src/access.js            Validación opcional de Access
migrations/              Esquema compatible con el MVP
scripts/                 Secretos locales y botón de despliegue
tests/                   Seguridad, despliegue e integración local
wrangler.jsonc           Solo Worker + Static Assets + D1 por defecto
.dev.vars.example        Nombres de secretos, sin valores utilizables
package-lock.json        Versiones reproducibles de herramientas
```

Licencia MIT, conservada del proyecto original. La entrega no incluye dependencias instaladas, secretos, bases locales ni archivos personales. Quedan pendientes despliegue real, pruebas con cuentas de proveedores, recuperación de contraseña, importación/restauración completa, OCR y contenido multimodal.
