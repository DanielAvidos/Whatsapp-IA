FROM node:20-slim

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y \
  ca-certificates \
  openssl \
  curl \
  dnsutils \
  iproute2 \
  git \
  openssh-client \
  dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_OPTIONS="--dns-result-order=ipv4first"
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["dumb-init","--"]
CMD ["npm","start"]
