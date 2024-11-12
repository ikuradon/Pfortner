FROM denoland/deno:2.0.6

WORKDIR /app
COPY --chown=deno src/deps.ts src/
RUN deno cache src/deps.ts

COPY --chown=deno . .
RUN deno cache scripts/serve.ts

USER deno
EXPOSE 3000
CMD ["task", "serve"]
