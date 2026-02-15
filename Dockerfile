FROM denoland/deno:2.0.6

WORKDIR /app
COPY --chown=deno src/deps.ts src/
RUN deno cache src/deps.ts

COPY --chown=deno . .
RUN deno cache scripts/serve.ts

USER deno
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD deno eval "const res = await fetch('http://localhost:3000', {headers: {'Accept': 'application/nostr+json'}}); if (!res.ok) Deno.exit(1);"

CMD ["task", "serve"]
