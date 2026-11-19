# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:server

# The server is bundled into one file, so the runtime image needs no node_modules.
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    EASEL_DB=/app/data/easel.db
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server.cjs ./server.cjs
COPY LICENSE ./
RUN mkdir data && chown node:node data
USER node
VOLUME /app/data
EXPOSE 8787
CMD ["node", "server.cjs"]
