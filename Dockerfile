FROM denoland/deno:2.7.5

WORKDIR /app
COPY --chown=deno src/deps.ts src/
COPY --chown=deno scripts/deps.ts scripts/
RUN deno cache src/deps.ts scripts/deps.ts

COPY --chown=deno . .
RUN deno cache scripts/serve.ts

USER deno
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD deno eval "const res = await fetch('http://localhost:3000', {headers: {'Accept': 'application/nostr+json'}}); if (!res.ok) Deno.exit(1);"

CMD ["task", "serve"]
