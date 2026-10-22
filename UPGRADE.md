# Actualizar una instalación operativa: 0.2 / 0.3 → 0.4

Añade modos, niveles de razonamiento, imágenes y APIs personalizadas, incluidos RunPod Serverless vLLM y Pods compatibles. Conserva contraseña, claves cifradas, proyectos e historial. **R2 y Access siguen siendo opcionales y desactivados por defecto.**

1. Haz una copia privada de D1 y conserva la misma `VAULT_KEY`. No borres la base ni generes secretos nuevos.
2. Descarga `ownaichat-actualizacion-v0.4.0.zip` y sube **todos** los archivos de `ownaichat-cloudflare/` a la raíz del repositorio de Workers Builds, reemplazando los coincidentes. Incluye los módulos nuevos y `migrations/0002_custom_modes_images.sql`.
3. **Conserva tu `wrangler.jsonc` actual.** El ZIP de actualización no lo contiene, ni `.dev.vars`, `.dev.vars.example` o la migración inicial. Mantén nombre de Worker, Database ID, cuenta, binding `DB` y secretos existentes. El ZIP completo contiene configuración de plantilla, no los IDs de tu instalación.
4. **Sí hay una migración D1 nueva.** En Workers Builds usa deploy `npm run deploy`, que aplica `npm run db:remote` antes de publicar. Si tu comando personalizado solo publica, antepón `npm run db:remote &&` a ese comando. Se aplica al binding `DB` de tu base actual, no al UUID de ejemplo del ZIP completo. No crees otra base.
5. Publica los cambios. Wrangler registra 0002 y no vuelve a aplicarla en el siguiente deploy. Añade tablas/columnas sin borrar las originales. Si falla, no publiques el Worker nuevo hasta resolverlo. No ejecutes repetidamente el SQL a mano.
6. Recarga la app; si la PWA conserva estáticos anteriores, cierra y vuelve a abrirla. La caché pasa a v4.
7. En DeepSeek elige Razonamiento → Bajo/Alto/Máximo. En familias OpenAI compatibles aparecen sus niveles, incluido Muy alto cuando procede. Automático respeta el proveedor. Imagen requiere un modelo generador, no cualquier chat.
8. En Configuración → APIs personalizadas → Añadir conexión configura RunPod u otro servidor compatible. Ejemplos en README: Serverless `https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1`; Pods `https://POD_ID-PUERTO.proxy.runpod.net/v1`. No uses `/run` o `/runsync` como chat.

No hay secretos Cloudflare nuevos. Las claves personalizadas se guardan desde la app, cifradas con tu `VAULT_KEY`. Las imágenes se almacenan en D1 sin activar adjuntos/R2; la exportación JSON no incluye sus binarios.

`no such table: custom_providers` o `no such column: settings`: falta 0002 en la D1 usada por el Worker. Si reaparece D1 **7404**, comprueba la cuenta y Database ID: no se resuelve regenerando secretos, creando `.dev.vars.example` o borrando D1.

El ZIP de actualización es acumulativo desde 0.2 y también sirve sobre 0.3. `ownaichat-cloudflare-v0.4.0.zip` contiene todo el proyecto para instalaciones nuevas. Ninguno contiene tus datos. La validación es local y simulada: no se ha desplegado ni comprobado en tus cuentas Cloudflare o RunPod.
