FROM node:20-alpine
WORKDIR /src

COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
CMD ["npm", "start"]
