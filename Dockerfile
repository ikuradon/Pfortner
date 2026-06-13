FROM denoland/deno:2.8.3@sha256:438618d8c0678c3154fc77ad6edad61f38cbc42803a181e7908d3e2c9e645022

WORKDIR /app

COPY --chown=deno deno.json deno.lock* ./
COPY --chown=deno mod.ts ./
COPY --chown=deno src ./src
COPY --chown=deno scripts ./scripts

RUN deno cache src/server/main.ts scripts/build_admin_islands.ts
RUN deno task build:admin-assets
RUN mkdir -p /data && chown deno:deno /data

USER deno
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD deno eval "const res = await fetch('http://localhost:3000/health'); if (!res.ok) Deno.exit(1);"

CMD ["task", "serve"]
