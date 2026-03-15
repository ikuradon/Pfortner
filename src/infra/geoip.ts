export type GeoIpLookup = (ip: string) => string | null;

export async function createGeoIpLookup(dbPath: string): Promise<GeoIpLookup | null> {
  try {
    await Deno.stat(dbPath);
  } catch {
    return null; // File not found — GeoIP disabled
  }

  try {
    const maxmindModule = await import('maxmind');
    const maxmind = maxmindModule.default ?? maxmindModule;
    const reader = await maxmind.open(dbPath);
    return (ip: string): string | null => {
      try {
        const result = reader.get(ip) as { country?: { iso_code?: string } } | null;
        return result?.country?.iso_code ?? null;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}
