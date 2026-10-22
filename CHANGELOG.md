# Cambios

## 0.4.0 — 22 de octubre de 2026

- Modos Automático, Sin razonamiento, Razonamiento e Imagen; capacidades por modelo y persistencia D1 por chat/mensaje.
- Parámetros nativos por proveedor; esfuerzos muy alto/máximo solo en familias compatibles. No se muestra ni guarda la cadena de pensamiento.
- Generación OpenAI/Gemini/custom, con imágenes privadas en D1 fragmentado, máximo 6 MiB y sin R2.
- Conexiones personalizadas cifradas, RunPod Serverless vLLM y Pods OpenAI compatibles; /run y /runsync necesitan adaptador.
- Validación HTTPS, sin redirecciones; clave nueva obligatoria al cambiar la URL de destino.
- Migración aditiva 0002, manteniendo intacta 0001; actualización acumulativa sin sobrescribir Wrangler/secretos. Caché PWA v4.
- Pruebas locales de parámetros, migración, conexiones, imágenes, privacidad, límites e historial. Sin despliegue ni claves reales de proveedores.

## 0.3.0 — 22 de octubre de 2026

- Selector de modelos por proveedor, con DeepSeek Flash y Pro visibles.
- Catálogos desde las APIs oficiales de DeepSeek, OpenAI, Gemini y Claude, sin exponer las claves al navegador.
- Paginación acotada, filtrado orientativo de modelos de texto, actualización manual y listas sugeridas ante errores.
- Opción de ID personalizado, preferencias por proveedor y conservación del modelo usado en cada chat.
- Valores iniciales correctos por proveedor y Flash para nuevos chats DeepSeek sin preferencia.
- Nueva versión de caché PWA, guía y ZIP de actualización que conservan la configuración Cloudflare existente.
- Pruebas de los catálogos, autenticación, privacidad, fallos y envío/persistencia del modelo seleccionado.

## 0.2.0 — 22 de octubre de 2026

- Marca visible OwnAIChat, manteniendo las tablas, cookies y configuración de datos del MVP OwnChat.
- Eliminado el binding R2 y su descripción de los recursos obligatorios. `FILES_ENABLED` y `ACCESS_ENABLED` desactivados por defecto.
- Capacidades de adjuntos anunciadas por la API; subida oculta y explicación visible cuando no están disponibles.
- Errores 409/503 explícitos para adjuntos desactivados o mal configurados. Conservación de archivos anteriores y protección frente al borrado de sus metadatos sin acceso al bucket original.
- Proyectos, chats, historial en D1 y conectores operativos sin servicios opcionales. Actualización del historial al volver a la ventana o pestaña.
- Validación opcional de JWT de Access en API y estáticos; mantiene la contraseña de la aplicación.
- Bootstrap cerrado sin secretos válidos; generador local con rechazo de sobrescritura; posibilidad de retirar el token de instalación después de crear el propietario.
- Despliegue con migraciones por binding `DB`, Workers Static Assets y esquema inicial intacto; no necesita migración destructiva.
- README revisado, configuración del enlace de despliegue, registro de validación, 35 pruebas locales y dependencias fijadas sin avisos conocidos al preparar la entrega.
