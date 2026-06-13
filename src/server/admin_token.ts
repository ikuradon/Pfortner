import { dirname } from '@std/path';
import type { AdminAuthState } from './types.ts';

export interface AdminAuthInput {
  enabled: boolean;
  token?: string;
  tokenFile?: string;
}

export async function resolveAdminAuth(input: AdminAuthInput): Promise<AdminAuthState> {
  if (!input.enabled) return { enabled: false, path: '/admin' };
  if (input.token) return { enabled: true, path: '/admin', token: input.token, tokenSource: 'env' };
  if (!input.tokenFile) throw new Error('admin token file is required when admin is enabled');

  try {
    const token = await readTokenFile(input.tokenFile);
    return { enabled: true, path: '/admin', token, tokenSource: 'file' };
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  const token = generateToken();
  await Deno.mkdir(dirname(input.tokenFile), { recursive: true });
  try {
    await Deno.writeTextFile(input.tokenFile, token, { createNew: true, mode: 0o600 });
    return { enabled: true, path: '/admin', token, tokenSource: 'generated' };
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }

  const existingToken = await readTokenFile(input.tokenFile);
  return { enabled: true, path: '/admin', token: existingToken, tokenSource: 'file' };
}

async function readTokenFile(path: string): Promise<string> {
  const token = (await Deno.readTextFile(path)).trim();
  if (token.length === 0) throw new Error('admin token file is empty');
  return token;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
