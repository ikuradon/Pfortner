import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { createGeoIpLookup } from './geoip.ts';

Deno.test('createGeoIpLookup returns null when DB file not found', async () => {
  const lookup = await createGeoIpLookup('/nonexistent/path.mmdb');
  assertEquals(lookup, null);
});

// Functional test requires actual MMDB file — skipped in CI
const GEOIP_DB = Deno.env.get('GEOIP_DB_PATH');
Deno.test({
  name: 'geoip lookup returns country code',
  ignore: !GEOIP_DB,
  async fn() {
    const lookup = await createGeoIpLookup(GEOIP_DB!);
    assertEquals(lookup !== null, true);
    // 8.8.8.8 is Google DNS — should return 'US'
    const result = lookup!('8.8.8.8');
    assertEquals(typeof result, 'string');
  },
});
