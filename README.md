# Setup environment

## Use docker compose

```
docker compose up
```

## Access web

https://localhost:8080

## Connect database

```
psql postgres://user:pass@localhost:35432/db
```


# Other options

## Run the server on your local

To run the server, run the following command

```
npm run dev
```

## Run the web server on docker

```
docker build -t spinhobby/express .
docker run -p 8080:5000 spinhobby/express
```
