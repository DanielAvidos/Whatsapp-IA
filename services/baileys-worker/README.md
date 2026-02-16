# Baileys Worker

Este servicio gestiona la conexión de WhatsApp utilizando la librería Baileys.

## Deploy DEV vs PROD

Utiliza los siguientes comandos para desplegar el worker en el proyecto correspondiente.

### DEV
Despliegue al proyecto de desarrollo:
```bash
gcloud run deploy baileys-worker-dev --source=. --project=whatsapp-ia-dev --region=us-central1 --allow-unauthenticated
```

### PROD
Despliegue al proyecto de producción:
```bash
gcloud run deploy baileys-worker --source=. --project=studio-6317141337-13e75 --region=us-central1 --allow-unauthenticated
```