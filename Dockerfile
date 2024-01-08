FROM denoland/deno:1.39.2

WORKDIR /app
COPY --chown=deno src/deps.ts src/
RUN deno cache src/deps.ts

COPY --chown=deno . .
RUN deno cache scripts/serve.ts

EXPOSE 3000
CMD ["task", "serve"]
