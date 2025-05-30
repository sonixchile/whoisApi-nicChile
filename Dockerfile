FROM denoland/deno:latest

WORKDIR /app

COPY deno.json import_map.json ./

RUN deno cache --config deno.json server.ts

COPY . .

EXPOSE 8000

CMD ["run", "-A", "--config", "deno.json", "server.ts"]