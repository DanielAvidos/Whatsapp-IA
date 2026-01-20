FROM node:20-slim

# Tools needed for some npm deps (git + ssh client)
RUN apt-get update && apt-get install -y --no-install-recommends \
  git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Force git to use HTTPS instead of SSH for GitHub (avoids missing SSH keys in Cloud Build)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global url."https://github.com/".insteadOf "git@github.com:" \
 && git config --global url."https://github.com/".insteadOf "ssh://github.com/"

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
