FROM node:20-slim

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y \
  git \
  openssh-client \
  ca-certificates \
  dumb-init \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["dumb-init","--"]
CMD ["npm","start"]
