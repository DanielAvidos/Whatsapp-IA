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
  // Soporte para ambos nombres de variable para evitar errores de config
  const base = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL;
  if (!base) {
    throw new Error('Falta la URL del worker (NEXT_PUBLIC_BAILEYS_WORKER_URL).');
  }
  return base.replace(/\/+$/, ''); // quita slash final
}

async function safeParseJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();

  // Si no es JSON, capturamos el error para debug sin romper la app
  if (!ct.includes('application/json')) {
    const preview = text.slice(0, 220).replace(/\s+/g, ' ').trim();
    return {
      error: `Respuesta NO-JSON del servidor (${res.status})`,
      status: res.status,
      preview,
      isHtml: ct.includes('text/html')
    };
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    return {
      error: "Error parseando JSON",
      status: res.status,
      preview: text.slice(0, 100)
    };
  }
}

export async function getBotConfig(channelId: string): Promise<{ ok: boolean; config?: WorkerBotConfig; error?: string; status?: number }> {
  const base = getWorkerBaseUrl();
  const url = `${base}/v1/channels/${encodeURIComponent(channelId)}/bot/config`;

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    const data = await safeParseJson(res);

    if (data.error) {
      return { ok: false, error: data.error, status: data.status };
    }

    if (!res.ok) {
      return { ok: false, error: data?.error || `Error ${res.status}`, status: res.status };
    }

    return { ok: true, config: data.config };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Error de red' };
  }
}

export async function putBotConfig(channelId: string, payload: Partial<WorkerBotConfig>): Promise<{ ok: boolean; config?: WorkerBotConfig; error?: string }> {
  const base = getWorkerBaseUrl();
  const url = `${base}/v1/channels/${encodeURIComponent(channelId)}/bot/config`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await safeParseJson(res);

    if (data.error) {
      return { ok: false, error: data.error };
    }

    if (!res.ok) {
      return { ok: false, error: data?.error || `Error ${res.status}` };
    }

    return { ok: true, config: data.config };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Error de red' };
  }
}
