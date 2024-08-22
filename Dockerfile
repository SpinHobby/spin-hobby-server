# # Base Image
# FROM node:16-alpine

# WORKDIR /src
# # install dependencies
# COPY ./package.json ./
# RUN npm install
# COPY ./ ./
# # RUN npm install -g ts-node
# # COPY ./ ./

# # Default command
# CMD ["npm", "run". "dev"]

FROM node:alpine
WORKDIR /src

COPY package.json .
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]
