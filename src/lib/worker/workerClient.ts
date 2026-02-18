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

export type WorkerResponse = {
  ok: boolean;
  config?: WorkerBotConfig;
  error?: string;
  status?: number;
  contentType?: string;
  rawPreview?: string;
  url?: string;
};

function getWorkerBaseUrl() {
  const base = process.env.NEXT_PUBLIC_BAILEYS_WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL;
  if (!base) {
    throw new Error('Falta la URL del worker (NEXT_PUBLIC_BAILEYS_WORKER_URL).');
  }
  return base.replace(/\/+$/, '');
}

async function safeParseJson(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!ct.includes('application/json')) {
    const preview = text.slice(0, 800).replace(/\s+/g, ' ').trim();
    return {
      error: `Respuesta NO-JSON (${res.status})`,
      status: res.status,
      contentType: ct,
      rawPreview: preview,
      isHtml: ct.includes('text/html')
    };
  }

  try {
    const json = JSON.parse(text);
    return { ...json, status: res.status, contentType: ct, rawPreview: text.slice(0, 800) };
  } catch (e) {
    return {
      error: "Error parseando JSON",
      status: res.status,
      contentType: ct,
      rawPreview: text.slice(0, 800)
    };
  }
}

export async function getBotConfig(channelId: string): Promise<WorkerResponse> {
  const base = getWorkerBaseUrl();
  const url = `${base}/v1/channels/${encodeURIComponent(channelId)}/bot/config`;

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    const data = await safeParseJson(res);

    return {
      ok: res.ok && !data.error,
      config: data.config,
      error: data.error,
      status: res.status,
      contentType: data.contentType,
      rawPreview: data.rawPreview,
      url
    };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Error de red', url };
  }
}

export async function putBotConfig(channelId: string, payload: Partial<WorkerBotConfig>): Promise<WorkerResponse> {
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

    return {
      ok: res.ok && !data.error,
      config: data.config,
      error: data.error,
      status: res.status,
      contentType: data.contentType,
      rawPreview: data.rawPreview,
      url
    };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Error de red', url };
  }
}
