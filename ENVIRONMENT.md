# Configuración de Entornos

Este documento detalla la relación entre las ramas de Git, los proyectos de Firebase y los servicios de Cloud Run para evitar despliegues cruzados.

## Entorno de PRODUCCIÓN
- **Rama:** `prod-stable-v1`
- **Proyecto Firebase:** `studio-6317141337-13e75`
- **Servicio Cloud Run (Worker):** `baileys-worker`
- **URL Worker:** `https://baileys-worker-701554958520.us-central1.run.app`

## Entorno de DESARROLLO (DEV)
- **Rama:** `dev-stable-v1-bot`
- **Proyecto Firebase:** `whatsapp-ia-dev`
- **Servicio Cloud Run (Worker):** `baileys-worker-dev`
- **URL Worker:** Configurada en el panel de Firebase App Hosting (variable `NEXT_PUBLIC_BAILEYS_WORKER_URL`)

---

### Recordatorio de Despliegue del Worker
Para desplegar el worker en el entorno correcto, usa los comandos documentados en `services/baileys-worker/README.md`. No olvides verificar el proyecto activo en `gcloud` antes de ejecutar el comando.
