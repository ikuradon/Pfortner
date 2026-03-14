import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { expandEnvVars } from './env.ts';

Deno.test('expandEnvVars replaces ${VAR} with env value', () => {
  Deno.env.set('TEST_TOKEN', 'secret123');
  const result = expandEnvVars({ token: '${TEST_TOKEN}', nested: { url: '${TEST_TOKEN}/path' } });
  assertEquals(result.token, 'secret123');
  assertEquals(result.nested.url, 'secret123/path');
  Deno.env.delete('TEST_TOKEN');
});

Deno.test('expandEnvVars leaves non-matching strings unchanged', () => {
  const result = expandEnvVars({ plain: 'hello', num: 42, bool: true, arr: [1, '${UNSET_VAR}'] });
  assertEquals(result.plain, 'hello');
  assertEquals(result.num, 42);
  assertEquals(result.bool, true);
  assertEquals(result.arr[0], 1);
  assertEquals(result.arr[1], '');
});
