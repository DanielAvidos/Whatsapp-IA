
FROM node:20-slim

# Install ffmpeg and clear apt cache
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Expose the default Cloud Run port
EXPOSE 8080

# Start the application using npm start script
CMD [ "npm", "start" ]
