# Cambios

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
