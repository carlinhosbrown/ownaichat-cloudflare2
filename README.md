# OwnAIChat 0.4 — tu IA privada en Cloudflare

Continuación del MVP OwnChat 0.1, conservando su interfaz, tablas D1, contraseña, cookies de sesión y conectores. Una cuenta privada por instalación; sin registro público.

**Configuración predeterminada: Workers + Static Assets + D1. R2 y Cloudflare Access están desactivados y no se aprovisionan.** Puedes usar el plan Workers Free y D1 dentro de sus cuotas, sin suscribirte a R2 ni configurar Zero Trust/Access. Las APIs de IA son servicios independientes: sus proveedores pueden cobrar por el uso.

Esta entrega incluye pruebas locales. No se ha desplegado ni verificado en una cuenta Cloudflare real. El aprovisionamiento mediante el botón y los límites reales de CPU del plan Free requieren esa comprobación antes del uso en producción.

**Si tu instalación 0.2 o 0.3 ya funciona**, utiliza el ZIP de actualización y conserva tu `wrangler.jsonc`, tu D1 y los secretos existentes. Aplica la nueva migración **0002_custom_modes_images.sql** antes de publicar el Worker. No necesita R2 ni Access. Consulta `UPGRADE.md`.

## Modos de respuesta

El compositor permite cambiar el modo antes de cada mensaje, también dentro de una conversación existente:

- **Automático:** no añade parámetros de razonamiento; respeta el comportamiento predeterminado del modelo, que puede incluir razonamiento.
- **Sin razonamiento:** solo aparece si se conoce una forma compatible de desactivarlo o si es un modelo reconocido sin razonamiento configurable.
- **Razonamiento:** muestra los niveles compatibles: mínimo, bajo, medio, alto, muy alto (`xhigh`) o máximo (`max`), según la familia. No todos los modelos tienen los mismos niveles ni permiten desactivarlo.
- **Generar imagen:** aparece para modelos de imágenes o si el catálogo contiene alguno. Desde un modelo de texto, seleccionarlo cambia al primer modelo de imágenes compatible. Volver a Automático recupera un modelo de texto; también puedes cambiar el modelo directamente.

DeepSeek Flash/Pro usan `thinking` y los niveles reales `low`, `high`, `max`; no se ofrecen niveles distintos que su API mapea al mismo esfuerzo alto. GPT y Gemini usan `reasoning_effort` con opciones condicionadas por familia. Claude 4.5 y anteriores reconocidos usan presupuestos de 1024/4096/8192 tokens para bajo/medio/alto; los adaptativos usan `output_config.effort`, con niveles adicionales solo en familias reconocidas. Claude adaptativo tiene un límite de 16000 tokens de salida en esta versión, incluido el razonamiento: un esfuerzo alto puede agotarlo antes de producir la respuesta final.

El esfuerzo «Automático» dentro de Razonamiento elige medio, si existe, o alto; en vLLM activa el pensamiento sin intensidad. Para no cambiar ningún parámetro usa el **modo Automático**. Se ignoran los campos/bloques separados de razonamiento y solo se conserva el texto de respuesta, sin panel de pensamiento. Los servidores personalizados deben separar esos campos con su parser: no se filtra texto `<think>` incrustado por un servidor en el propio contenido de respuesta. El modo y opciones se guardan en D1 por chat y mensaje; otro dispositivo recupera la última selección usada.

La detección está en `public/modes.js`: los catálogos no publican un esquema universal de capacidades y el reconocimiento por familias puede quedar desactualizado. Los modelos desconocidos mantienen Automático y la entrada manual. La compatibilidad final la determina la API. No se implementan búsqueda web, herramientas, audio, vídeo ni modo Pro de Responses.

Referencias: [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/), [OpenAI Docs: razonamiento](https://developers.openai.com/api/docs/guides/reasoning), [Gemini OpenAI](https://ai.google.dev/gemini-api/docs/openai), [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), [Claude esfuerzo](https://platform.claude.com/docs/en/build-with-claude/effort).

## Generación de imágenes sin R2

- **OpenAI:** GPT Image del catálogo o ID manual compatible, mediante `/v1/images/generations`; calidad y tamaños compatibles seleccionados. Calidad muy alta/máxima solo en GPT Image 2.5 reconocido. No se envía `response_format` a GPT Image.
- **Gemini:** modelos cuyo ID contiene `image` y que admiten `generateContent`, mediante su API nativa. Calidad y tamaño automáticos, sin enviar opciones OpenAI.
- **Custom:** configura «Modelo de imágenes» solo si el servidor implementa `/images/generations`, con respuesta `data[0].b64_json` o URL HTTPS pública. No se deduce ese soporte de cualquier handler RunPod.

Una imagen por solicitud, PNG/JPEG/WebP, máximo **6 MiB** por imagen y 12 MiB de JSON. Se comprueba la firma del formato; no se admiten SVG/HTML ni se siguen redirecciones. Las URLs devueltas se descargan sin reenviar la clave y no se guardan en el historial.

Las imágenes se guardan **en D1, divididas en fragmentos base64**, independientemente de los adjuntos de proyectos: no requieren activar R2. Consumen cuotas/almacenamiento D1 y aproximadamente un tercio adicional por base64; no está pensado como archivo masivo. Vista previa y descarga requieren sesión y nunca se cachean en la PWA. Borrar el chat elimina sus imágenes. La exportación JSON incluye metadatos, **no los binarios**: descarga las importantes y conserva una copia completa de D1.

Cada generación utiliza la descripción actual y las instrucciones/documentos de texto del proyecto; no las imágenes anteriores. No hay edición, máscaras, visión ni fotos de entrada. Cambiar después a texto no envía píxeles al modelo. Las APIs de imágenes pueden exigir permisos y cobrar por solicitud; RunPod puede cobrar por GPU/arranque. Una solicitud fallida o agotada puede haber tenido coste: comprueba el estado antes de repetir. No hay reintentos automáticos.

Referencias: [OpenAI Docs: imágenes](https://developers.openai.com/api/reference/resources/images/methods/generate), [Gemini imágenes](https://ai.google.dev/gemini-api/docs/image-generation).

## APIs personalizadas y RunPod

**Configuración → APIs personalizadas → Añadir conexión**. Hasta 20 conexiones; puedes editar/eliminar sin borrar sus chats. Aparecen como proveedores. Introduce nombre, tipo, URL base, ID exacto de modelo y clave Bearer independiente (o sin clave). El catálogo usa `/models`; si falla, conserva tus IDs y la entrada manual. El chat necesita **`/chat/completions` con streaming SSE de formato OpenAI**. No funciona con cualquier contrato API ni instala servidores.

| Tipo | URL base de ejemplo | Clave |
| --- | --- | --- |
| API compatible con OpenAI | `https://inferencia.ejemplo.com/v1` | La del servidor |
| RunPod Serverless vLLM | `https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1` | Tu clave RunPod autorizada para el endpoint |
| RunPod Pod | `https://POD_ID-8000.proxy.runpod.net/v1` | La del servidor vLLM/TGI/etc., si la exige; no necesariamente la de tu cuenta RunPod |

En Pods expón el puerto HTTP del servidor mediante el proxy HTTPS. Sustituye ID y puerto por los reales. Los handlers `/run` y `/runsync`, incluidos workflows ComfyUI o handlers a medida, **no son compatibles directamente**: requieren un adaptador con contrato OpenAI. Un Pod sin servidor de inferencia tampoco basta.

Configura exclusivamente el razonamiento que el servidor admita:

- **No configurado:** solo Automático, sin parámetros extra.
- **OpenAI:** `reasoning_effort`; declara sus niveles exactos (ej. `low,medium,high,xhigh`). Sin razonamiento necesita `none`.
- **DeepSeek:** `thinking` + `reasoning_effort`, con sus niveles admitidos.
- **vLLM:** `chat_template_kwargs.enable_thinking=true/false`, sin intensidad. Necesita un modelo y una plantilla compatibles; no añade esa capacidad a modelos que no la tienen.

Las claves se cifran y nunca se devuelven al navegador. Dejar la clave vacía al editar la conserva **solo con la misma URL base**; cambiar de destino requiere introducirla de nuevo. No se reutiliza ninguna clave incorporada para otros servidores. La exportación de historial no incluye configuraciones ni claves.

Solo destinos HTTPS públicos, puerto 443, sin credenciales ni secretos en la URL base. Se rechazan localhost, IPs literales y dominios locales comunes; no se siguen redirecciones. **No es aislamiento DNS ni protección completa frente a DNS rebinding:** configura solo servidores de confianza. Crear/usar conexiones requiere sesión; no es un proxy público. «Sin clave» no protege tu servidor: no lo expongas así si permite consumo de GPU sin autorización.

Referencias: [RunPod vLLM OpenAI](https://docs.runpod.io/serverless/vllm/openai-compatibility), [puertos de Pods](https://docs.runpod.io/pods/configuration/expose-ports).

## Elegir modelos

En la cabecera hay un selector de proveedor y otro de **Modelo de IA**. Cambia el modelo antes de enviar el siguiente mensaje; también puedes hacerlo dentro de una conversación existente.

- **DeepSeek:** opciones Flash (`deepseek-flash`) y Pro (`deepseek-v4-pro`). Las nuevas conversaciones sin preferencia guardada usan Flash; no se sustituye automáticamente el modelo de los chats anteriores.
- **OpenAI:** al guardar tu API Key, el servidor consulta `/v1/models` y muestra los modelos de chat reconocidos en la respuesta de esa cuenta, incluidos identificadores de modelos ajustados cuando son reconocibles.
- **Gemini y Claude:** también consultan su catálogo oficial, con paginación y nombres legibles cuando el proveedor los facilita.
- **Actualizar modelos** (↻) vuelve a consultar el proveedor. La lista se reutiliza durante la sesión del navegador para evitar solicitudes repetidas. Cambiar o eliminar una API Key invalida esa lista.
- **Otro modelo…** permite introducir un ID exacto que no aparezca en el selector, sin limitar los modelos válidos a la lista sugerida.

La indicación **Modelos de tu API** significa que el catálogo se consultó correctamente. **Modelos sugeridos** identifica una lista local de orientación, utilizada antes de configurar una clave o cuando el proveedor no responde. No garantiza que todos esos modelos estén habilitados en tu cuenta. El detalle del aviso se muestra al situar el puntero sobre esa indicación; al actualizar manualmente también se muestra el error.

La API Key se descifra solo en el Worker; la respuesta al navegador contiene únicamente modelos y avisos. Los fallos del catálogo no cierran la sesión ni bloquean la selección manual.

La selección se recuerda por proveedor en ese navegador. El proveedor y modelo usados se guardan además en el chat de D1: al abrirlo desde otro dispositivo se recupera su última selección utilizada. Elegir otro modelo no modifica los mensajes anteriores.

El conector OpenAI de texto sigue usando **Chat Completions**. El selector reconoce texto y GPT Image, y excluye familias conocidas de vídeo, embeddings, audio, Realtime, Codex y modelos Pro que requieren Responses. Gemini reconoce chat e imagen con `generateContent`. `/models` no declara compatibilidad por endpoint; el filtro es orientativo y no comprueba permisos/saldo. La entrada manual no añade otros endpoints o modalidades.

Referencias oficiales: [DeepSeek](https://api-docs.deepseek.com/api/list-models/), [OpenAI Docs: lista de modelos](https://developers.openai.com/api/reference/resources/models/methods/list), [Gemini](https://ai.google.dev/api/models), [Claude](https://platform.claude.com/docs/en/api/models/list).

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TU_USUARIO/ownaichat)

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
6. Añade las API Keys desde Configuración. Elige un modelo del selector de DeepSeek, OpenAI, Gemini o Anthropic; si no aparece, utiliza Otro modelo… e introduce su ID.
7. Después de crear la cuenta puedes eliminar `BOOTSTRAP_TOKEN` de los secretos del Worker. Conserva **la misma `VAULT_KEY`**: sigue siendo necesaria para iniciar sesión y descifrar las API Keys.

El UUID `00000000-0000-0000-0000-000000000000` es un marcador para la plantilla; el flujo del botón debe reemplazarlo por el D1 creado antes de ejecutar las migraciones. Para despliegue manual debes sustituirlo tú. No existe aprovisionamiento automático de R2 por parte de la aplicación.

Referencias oficiales: [botón y aprovisionamiento](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [configuración de Assets](https://developers.cloudflare.com/workers/static-assets/binding/), [secretos](https://developers.cloudflare.com/workers/configuration/secrets/).

## Qué funciona sin R2 ni Access

- Inicio de sesión privado por contraseña, sesiones HttpOnly, Secure en producción y SameSite=Strict; protección de origen y limitación básica de intentos.
- Chats, instrucciones de proyectos y mensajes almacenados en D1; streaming SSE de las respuestas.
- El mismo historial desde dispositivos diferentes al iniciar sesión en la **misma URL**. La interfaz consulta D1 al volver a la ventana o pestaña; también puedes recargarla. No utiliza WebSockets ni una sincronización continua en segundo plano.
- DeepSeek, OpenAI, Gemini y Anthropic con endpoints oficiales fijos. Claves cifradas en D1 mediante AES-256-GCM, sin devolverlas al navegador.
- Conexiones personalizadas y RunPod compatible, modos por mensaje e imágenes en D1 sin R2.
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
4. `0001_initial.sql` no cambia. Añade **0002_custom_modes_images.sql**, que incorpora conexiones, opciones e imágenes sin eliminar datos. `npm run deploy` aplica las migraciones pendientes antes de publicar. No ejecutes el SQL de 0002 repetidamente a mano: Wrangler registra su aplicación. No necesitas otra base.
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

Se comprueban autenticación, bootstrap, secretos, sesiones, proyectos, historial multidispositivo, R2/Access opcionales, catálogos y despliegue. Se añaden migración desde datos anteriores, parámetros nativos de razonamiento, rechazo de opciones incompatibles, custom/RunPod simulados, claves y cambios de URL, imágenes OpenAI/Gemini/custom, límites, fragmentación, descarga privada y borrado en cascada. No llaman a cuentas reales ni consumen tokens/GPU.

El archivo `VALIDATION.md` registra los resultados de esta entrega y diferencia las pruebas locales de los pasos no realizados en Cloudflare.

## Archivos principales

```text
public/                  Interfaz, estilos, PWA y cabeceras
src/worker.js            Contraseña, sesiones, D1, archivos y conectores
src/models.js            Lectura de catálogos desde las APIs oficiales
src/connections.js       Conexiones personalizadas y validación de destinos
src/images.js            Generación y almacenamiento privado de imágenes en D1
public/models.js         Sugerencias, valores iniciales y filtrado de modelos
public/modes.js          Capacidades y parámetros compartidos por UI y Worker
src/access.js            Validación opcional de Access
migrations/              Esquema compatible con el MVP
scripts/                 Secretos locales y botón de despliegue
tests/                   Seguridad, despliegue e integración local
wrangler.jsonc           Solo Worker + Static Assets + D1 por defecto
.dev.vars.example        Nombres de secretos, sin valores utilizables
package-lock.json        Versiones reproducibles de herramientas
```

Licencia MIT, conservada del proyecto original. La entrega no incluye dependencias instaladas, secretos, bases locales ni archivos personales. Pendientes: despliegue real, pruebas con proveedores/RunPod reales, recuperación de contraseña, restauración completa, OCR, edición de imágenes y entrada multimodal.
