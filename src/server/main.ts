import { createServerRuntime } from './runtime.ts';

if (import.meta.main) {
  try {
    const runtime = await createServerRuntime({});
    Deno.serve(
      {
        hostname: runtime.runtime.listen.hostname,
        port: runtime.runtime.listen.port,
      },
      runtime.handler,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}
