# Configuración de Entornos

Este documento detalla la relación entre las ramas de Git, los proyectos de Firebase y los servicios de Cloud Run para evitar despliegues cruzados.

## Entorno de DESARROLLO (DEV)
- **Rama Actual:** `dev-stable-v1-bot`
- **Proyecto Firebase:** `whatsapp-ia-dev`
- **Servicio Cloud Run (Worker):** `baileys-worker-dev`
- **URL Worker:** Configurada en el panel de Firebase App Hosting (variable `NEXT_PUBLIC_BAILEYS_WORKER_URL`)

## Entorno de PRODUCCIÓN (PROD)
- **Rama:** `prod-stable-v1`
- **Proyecto Firebase:** `studio-6317141337-13e75`
- **Servicio Cloud Run (Worker):** `baileys-worker`
- **URL Worker:** `https://baileys-worker-701554958520.us-central1.run.app`

---

### Gestión de Variables de Entorno
1. **Local:** Usa exclusivamente `.env.local` (este archivo está ignorado por git).
2. **Hosting:** Las variables se configuran directamente en el panel de Firebase Console (App Hosting -> Environment variables).
3. **Plantillas:** Usa `.env.example` solo como referencia de los nombres de las variables necesarias.
