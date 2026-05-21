````md
# WhatsApp-IA

Sistema de automatización de WhatsApp basado en Baileys + Firebase + Next.js.

---

# 🚨 CONTEXTO CRÍTICO PARA IA

Este proyecto YA está en producción, YA está estabilizado y tiene módulos interconectados.

NO es greenfield.  
NO debe reestructurarse.  
NO debe reinterpretarse.  
NO debe regenerarse.

Principio absoluto:

> Este sistema es incremental, no regenerativo.

Cualquier refactor global, cambio de arquitectura, duplicación de componentes o reescritura completa se considera error crítico.

---

# 🧱 ÁREAS SEPARADAS DEL SISTEMA

## 1. Frontend

Ubicación principal:

```txt
/src
````

Responsable de:

* UI
* navegación
* lectura/escritura Firestore desde cliente
* contactos
* etiquetas
* campañas
* chatbot UI
* embudo
* chats

---

## 2. Cloud Functions

Ubicación:

```txt
/functions
```

Responsable de:

* lógica backend programada
* schedulers
* automatizaciones
* campañas programadas
* seguimiento automático

Regla:
NO modificar funciones existentes si no es necesario.

Especialmente NO tocar el comportamiento de:

```txt
followupTickEveryMinute
```

Esta función ya trabaja para seguimiento automático y está estable.

Si se necesita una lógica nueva, crear una función independiente.

---

## 3. Baileys Worker

Ubicación:

```txt
/services/baileys-worker
```

Responsable de:

* conexión WhatsApp
* QR
* sesiones
* envío real de mensajes
* recepción de mensajes
* media

Regla:
NO modificar el worker salvo instrucción explícita.

---

# 🔐 REGLAS INVIOLABLES

NO modificar:

* Firestore Rules
* Storage Rules
* firebase.json
* apphosting.yaml
* .env.local
* configuración Firebase
* worker Baileys
* funciones estables existentes
* estructura base de ChatInterface
* estructura global del proyecto

NO hacer:

* refactor global
* reestructurar carpetas
* duplicar lógica
* duplicar componentes críticos
* crear endpoints innecesarios
* enviar mensajes desde frontend
* borrar conversaciones al borrar contactos
* borrar mensajes al borrar contactos
* tocar producción sin instrucción explícita

---

# 🌎 ENTORNOS

## DEV

```txt
projectId: whatsapp-ia-dev
worker: baileys-worker-dev
```

## PROD

```txt
projectId: studio-6317141337-13e75
worker: baileys-worker
```

DEV y PROD no deben mezclarse.

---

# ⚙️ VARIABLES DE ENTORNO

## Local

Archivo:

```txt
.env.local
```

Sirve para:

```bash
npm run dev
```

## App Hosting

Archivo:

```txt
apphosting.yaml
```

Sirve para despliegue en Firebase App Hosting.

Importante:
`.env.local` NO sirve para App Hosting.
`apphosting.yaml` NO sirve para correr local si Next.js no carga esas variables.

Variables requeridas:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_BAILEYS_WORKER_URL=
```

---

# 🗂️ MODELO FIRESTORE PRINCIPAL

```txt
channels/{channelId}
```

## Conversaciones

```txt
channels/{channelId}/conversations/{jid}
channels/{channelId}/conversations/{jid}/messages/{messageId}
```

## Runtime

```txt
channels/{channelId}/runtime/bot
channels/{channelId}/runtime/followup
```

## Contactos

Los contactos son una capa adicional sobre conversaciones.

Pueden existir:

* contactos ligados a conversación
* contactos manuales sin conversación

Regla:
Eliminar un contacto NO debe eliminar conversación ni mensajes.

## Etiquetas

Las etiquetas viven por canal y pueden asignarse a contactos mediante `tagIds`.

## Campañas

```txt
channels/{channelId}/campaigns/{campaignId}
channels/{channelId}/campaigns/{campaignId}/recipients/{recipientId}
```

Estados de campaña:

```txt
created
scheduled
active
paused
completed
cancelled
failed
```

Regla:
El frontend puede crear, editar, pausar, activar o cancelar campañas, pero el envío real debe ocurrir desde Cloud Functions.

---

# 📇 CONTACTOS

Campos habituales:

```txt
name / displayName
phone / phoneE164
email
company
notes
tagIds
source
createdAt
updatedAt
conversationId / jid opcional
```

Nombre mostrado, prioridad:

```txt
customer.name
displayName
name
phoneE164
jid
```

Reglas:

* Nombre y teléfono son obligatorios al crear manualmente.
* Email, empresa y notas son opcionales.
* Contacto manual puede no tener conversación.
* No asumir que todo contacto tiene `jid`.
* No borrar conversaciones desde contactos.

---

# 🏷️ ETIQUETAS

Reglas:

* Se asignan a contactos mediante `tagIds`.
* No duplicar etiquetas por mayúsculas/minúsculas o espacios.
* UI debe soportar muchas etiquetas.
* Mostrar chips limitados y `+N más` si hay demasiadas.

---

# 📣 CAMPAÑAS

Las campañas sirven para envío agrupado de mensajes a contactos.

Audiencia:

* contactos individuales
* etiquetas
* selección mixta

Reglas:

* No enviar todos los mensajes de golpe.
* Envío gradual desde Cloud Functions.
* Máximo recomendado: 1 recipient cada 2 minutos por campaña.
* No enviar desde frontend.
* No llamar worker directamente desde UI.
* Respetar horarios si existe configuración del canal.
* Guardar logs/error por recipient.

La función de campañas debe ser independiente de `followupTickEveryMinute`.

---

# 💬 CHAT

Componente crítico:

```txt
ChatInterface
```

Reglas:

* NO duplicar
* NO reescribir
* NO cambiar estructura base
* NO eliminar funcionalidades
* NO romper envío/recepción
* NO romper media
* NO romper seguimiento

---

# 🤖 SEGUIMIENTO AUTOMÁTICO

Función crítica existente:

```txt
followupTickEveryMinute
```

Responsabilidad:

* revisar seguimiento automático
* generar mensajes IA
* enviar vía Baileys
* programar siguiente toque
* usar locks
* respetar horario

Regla:
NO modificar su comportamiento para campañas.
Campañas deben usar función separada.

---

# 📦 FUNCIONALIDADES EXISTENTES

## Mensajes

* texto envío/recepción
* imágenes envío/recepción
* audio recepción
* audio envío sensible

## IA

* chatbot por canal
* activación por conversación
* seguimiento automático

## Contactos

* creación manual
* edición
* eliminación segura
* importación masiva
* etiquetas

## Etiquetas

* creación
* asignación a contactos
* visualización en tarjetas

## Campañas

* creación
* audiencia por contactos/etiquetas
* recipients
* estados
* envío gradual por función programada

---

# 🧪 FLUJO DE DESARROLLO

Rama estable actual de trabajo:

```bash
contacts-labels-v2
```

Comandos:

```bash
git status
git branch
git checkout contacts-labels-v2
git pull origin contacts-labels-v2

npm install
npm run dev
npm run build
git diff
```

Si se usan functions:

```bash
cd functions
npm install
cd ..
```

---

# 🚀 DEPLOY

## Frontend App Hosting

```bash
firebase deploy --only apphosting:studio --project whatsapp-ia-dev
```

## Functions DEV

```bash
firebase deploy --only functions --project whatsapp-ia-dev
```

## Worker DEV

Solo si se solicita explícitamente:

```bash
gcloud run deploy baileys-worker-dev \
  --source=services/baileys-worker \
  --region=us-central1 \
  --project=whatsapp-ia-dev
```

---

# 🧠 INSTRUCCIONES PARA IA / ANTIGRAVITY

Antes de modificar:

1. Leer este README.
2. Inspeccionar archivos existentes.
3. Identificar si el cambio pertenece a:

   * frontend
   * functions
   * worker
4. Tocar solo lo mínimo necesario.
5. No asumir estructura inexistente.
6. No crear arquitectura nueva.
7. No tocar producción.
8. Mostrar plan breve.
9. Después mostrar archivos modificados.

Si no estás seguro:

NO hagas cambios.

---

# ✅ CAMBIOS PERMITIDOS

* UI incremental
* nuevos componentes aislados
* lectura/escritura Firestore segura
* mejoras visuales
* validaciones puntuales
* nuevas funciones independientes
* nuevos módulos aislados
* logs y manejo de errores

---

# ❌ CAMBIOS PROHIBIDOS

* refactor global
* reescribir ChatInterface
* modificar worker sin instrucción
* modificar followupTickEveryMinute sin instrucción
* cambiar reglas Firebase
* cambiar configuración Firebase
* borrar datos existentes
* cambiar estructura Firestore estable
* enviar mensajes masivos desde frontend
* crear duplicación de lógica

---

# 🧨 REGLA FINAL

Es mejor no hacer cambios que romper el sistema.

Todo cambio debe ser:

* pequeño
* controlado
* verificable
* reversible
* incremental

```
```
