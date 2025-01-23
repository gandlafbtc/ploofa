# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
COPY . .
RUN bun install
RUN bun build --compile --minify --sourcemap --target=bun-linux-x64 ./src/index.ts --outfile ploofa

# copy production to prod
FROM oven/bun:distroless AS release
WORKDIR /app
COPY --from=install /app/ploofa /app/ploofa

# run the app
EXPOSE 3001/tcp
ENTRYPOINT ["./ploofa"]
