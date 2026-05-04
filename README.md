# WhatsApp-IA

Sistema de automatización de WhatsApp basado en Baileys + Firebase + Next.js.

---

# 🚨 CONTEXTO CRÍTICO PARA IA (OBLIGATORIO LEER)

Este proyecto:

- YA está en producción
- YA está estabilizado
- YA tiene múltiples módulos interconectados

👉 NO es un proyecto greenfield  
👉 NO debe ser reestructurado  
👉 NO debe ser reinterpretado  

---

# 🧠 PRINCIPIO ABSOLUTO

> Este sistema es **incremental**, NO regenerativo.

Cualquier intento de:
- reescribir
- reorganizar
- optimizar globalmente

👉 SE CONSIDERA ERROR CRÍTICO

---

# 🏗️ ARQUITECTURA

## Frontend
- Next.js
- Ubicación: `/src`
- Render principal: React Components

### Pantallas principales
- Conexión
- Chats
- Chatbot
- Embudo de ventas
- Contactos (capa visual)

---

## Backend

### Baileys Worker
- Ubicación: `/services/baileys-worker`
- Deploy: Google Cloud Run
- Responsabilidades:
  - Conexión a WhatsApp
  - Envío/recepción de mensajes
  - Descarga de media
  - Subida a Firebase Storage

🚨 REGLA:
NO modificar este worker salvo instrucción explícita

---

## Base de datos
- Firestore

## Storage
- Firebase Storage

---

# 🔐 REGLAS INVIOLABLES

❌ NO modificar Firestore Rules  
❌ NO modificar Storage Rules  
❌ NO modificar Firebase config  
❌ NO ejecutar `firebase init`  
❌ NO crear nuevas configuraciones Firebase  
❌ NO cambiar estructura de documentos Firestore  
❌ NO borrar campos existentes  
❌ NO tocar Cloud Functions existentes  
❌ NO crear duplicación de lógica  

---

# ⚙️ VARIABLES DE ENTORNO

Archivo: `.env.local` (NO subir a Git)

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

📊 MODELO DE DATOS (FIRESTORE)
channels/
  {channelId}/
    conversations/
      {jid}/
        name
        phoneE164
        displayName
        isContact
        customer: {
          name
          phone
          email
          company
          notes
          isContact
          source
        }
        botEnabled
        followupEnabled
        funnelStage
        lastMessage
        messages/
🧩 LÓGICA DE CONTACTOS

Los contactos NO reemplazan datos de Baileys.

Son una capa adicional.

Regla clave:

Baileys puede seguir sobrescribiendo:

name
pushName

Pero la UI debe priorizar:

customer.name (si isContact)
displayName
name
phoneE164
jid
💬 CHAT (CRÍTICO)
ChatInterface

🚨 COMPONENTE MÁS IMPORTANTE 🚨

REGLAS:

❌ NO duplicar
❌ NO reescribir
❌ NO crear versiones paralelas
❌ NO modificar estructura base
❌ NO eliminar funcionalidades

📦 FUNCIONALIDADES EXISTENTES
Mensajes
✅ Texto envío/recepción
✅ Imágenes envío/recepción
✅ Audio recepción
⚠️ Audio envío (estable pero sensible)
IA
Activación por conversación
Seguimiento automático (FU)
Palabras clave:
s3gu1r
d3t3n3r
Embudo de ventas
Etapas configurables
Movimientos de conversación
Contactos
Basados en conversaciones
Persistencia en Firestore
UI prioritaria
🎯 REGLAS DE UI
Nombre mostrado

Orden de prioridad:

customer.name
displayName
name
phoneE164
jid
🚫 CAMBIOS PROHIBIDOS

❌ Refactor global
❌ Reestructurar carpetas
❌ Crear nueva arquitectura
❌ Reescribir ChatInterface
❌ Cambiar lógica de mensajes
❌ Cambiar worker
❌ Crear duplicación de componentes

✅ CAMBIOS PERMITIDOS

✔ UI incremental
✔ Nuevos componentes aislados
✔ Lectura de Firestore
✔ Mejoras visuales
✔ Capas adicionales (ej: contactos)

🧪 FLUJO DE DESARROLLO
git checkout -b nueva-rama

npm install
npm run dev
npm run build

git diff
🚀 DEPLOY
Frontend

Firebase Studio / App Hosting

Worker
gcloud run deploy baileys-worker-dev \
  --source=services/baileys-worker
🧠 INSTRUCCIONES PARA IA

ANTES DE HACER CAMBIOS:

Leer completamente este README
NO asumir contexto externo
NO crear lógica nueva innecesaria
NO modificar más de lo solicitado
NO reconstruir componentes

SI NO ESTÁS SEGURO:

👉 NO HAGAS CAMBIOS

🧨 REGLA FINAL

Es mejor NO hacer cambios que romper el sistema.

📌 ESTADO

Sistema funcional y estable.

Cambios deben ser:

pequeños
controlados
verificables