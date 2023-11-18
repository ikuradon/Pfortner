FROM denoland/deno:1.38.2

WORKDIR /app
COPY --chown=deno src/deps.ts src/
RUN deno cache src/deps.ts

COPY --chown=deno . .
RUN deno cache src/main.ts

EXPOSE 3000
CMD ["task", "serve"]
