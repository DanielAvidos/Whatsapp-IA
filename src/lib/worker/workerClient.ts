'use client';

/**
 * @fileOverview Cliente robusto para comunicarse con el worker de Baileys.
 */

export type WorkerBotConfig = {
  enabled: boolean;
  productDetails: string;
  salesStrategy: string;
  updatedAt?: string;
  updatedByUid?: string;
  updatedByEmail?: string;
  lastAutoReplyAt?: string;
};

function getWorkerBaseUrl() {
  // Estandarizado a NEXT_PUBLIC_BAILEYS_WORKER_URL para coincidir con el resto de la app
  const base = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL;
  if (!base) {
    throw new Error('Falta NEXT_PUBLIC_BAILEYS_WORKER_URL (debe apuntar al Cloud Run del worker).');
  }
  return base.replace(/\/+$/, ''); // quita slash final si existe
}

async function safeParseJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();

  // Si no es JSON, es un error de Express (404, etc.) o del Hosting
  if (!ct.includes('application/json')) {
    const preview = text.slice(0, 220).replace(/\s+/g, ' ').trim();
    throw new Error(`Respuesta NO-JSON del worker (${res.status}). Content-Type="${ct}". Preview="${preview}"`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const preview = text.slice(0, 220).replace(/\s+/g, ' ').trim();
    throw new Error(`JSON inválido del worker (${res.status}). Preview="${preview}"`);
  }
}

export async function getBotConfig(channelId: string): Promise<WorkerBotConfig> {
  const base = getWorkerBaseUrl();
  const url = `${base}/v1/channels/${encodeURIComponent(channelId)}/bot/config`;

  const res = await fetch(url, { method: 'GET', mode: 'cors' });
  const data = await safeParseJson(res);

  if (!res.ok) {
    throw new Error(data?.error || `Error HTTP ${res.status}`);
  }
  return data.config as WorkerBotConfig;
}

export async function putBotConfig(channelId: string, payload: Partial<WorkerBotConfig>): Promise<WorkerBotConfig> {
  const base = getWorkerBaseUrl();
  const url = `${base}/v1/channels/${encodeURIComponent(channelId)}/bot/config`;

  const res = await fetch(url, {
    method: 'PUT',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await safeParseJson(res);

  if (!res.ok) {
    throw new Error(data?.error || `Error HTTP ${res.status}`);
  }
  // El worker ahora devuelve el objeto 'config' completo o actualizado
  return data.config as WorkerBotConfig;
}
