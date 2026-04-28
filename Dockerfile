FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npx prisma generate

RUN npm run build

# Service dispatch: Railway sets RAILWAY_RUN_CMD per service to override
# the default web start command. Worker service sets it to
# "npx tsx app/server/worker.ts"; web service leaves it unset and gets
# the default "npm run docker-start" (which runs prisma migrate deploy
# then react-router-serve). The worker MUST NOT run migrations — only
# the web service does.
CMD ["sh", "-c", "${RAILWAY_RUN_CMD:-npm run docker-start}"]
