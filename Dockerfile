FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium fonts-liberation libappindicator3-1 \
    libasound2 libatk-bridge2.0-0 libnspr4 libnss3 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    xdg-utils --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

# v27 force rebuild - all files must be fresh
RUN echo "BUILD_V27_$(date +%s)" > /app/.build-version && cat /app/server.js | head -1

CMD ["node", "server.js"]
