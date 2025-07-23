# Setup environment

## Put environment file

create `.env` file in root directory

Copy the content below and paste it in the file

```
username=postgres
password=pass
database=db
host=localhost
port=35432
```

## Use docker compose

```
docker compose up
```

## Access web

https://localhost:8080

## Connect database if you already have psql in your local

```
psql postgres://user:pass@localhost:35432/db
```

## Connect database if you don't have psql in your local

To connect Docker container 

```
docker compose exec db bash
```

To connect database

```
psql postgres://user:pass@localhost/db
```

# Other options (No need to run if settings above works)

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

## docker build from scrach 

```
docker compose up --build
```
