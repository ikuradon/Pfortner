export type ParsedClientMessage =
  | { ok: true; message: unknown[] }
  | { ok: false; notice: string; warning?: string };

export function parseClientMessagePayload(payload: unknown): ParsedClientMessage {
  if (typeof payload !== 'string') {
    return { ok: false, notice: 'ERROR: bad msg: non-string message' };
  }

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, notice: 'ERROR: bad msg: expected JSON array' };
    }
    return { ok: true, message: parsed };
  } catch (e) {
    return {
      ok: false,
      notice: 'ERROR: bad msg: unparsable JSON',
      warning: `Failed to parse client message: ${e}`,
    };
  }
}
