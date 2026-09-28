# Spin Hobby server

## Existing server environment

### Put environment file

create `.env` file in root directory

Copy the content below and paste it in the file

```
username=postgres
password=pass
database=db
host=localhost
port=35432
```

### Use Docker Compose

```
docker compose up
```

### Access web

https://localhost:8080

### Connect database if you already have psql locally

```
psql postgres://user:pass@localhost:35432/db
```

### Connect database if you do not have psql locally

To connect Docker container 

```
docker compose exec db bash
```

To connect database

```
psql postgres://user:pass@localhost/db
```

## Other options

### Run the server locally

To run the server, run the following command

```
npm run dev
```

### Run the web server in Docker

```
docker build -t spinhobby/express .
docker run -p 8080:5000 spinhobby/express
```

### Build Docker from scratch

```
docker compose up --build
```

## Supabase commerce backend

The `supabase/` directory adds the backend used by the new Spin Hobby storefront and admin designs:

- Square catalog and inventory mirroring.
- Supabase Auth profiles and customer, staff, and owner access controls.
- Edge API routes for catalog, cart pricing, checkout, orders, homepage, and admin workflows.
- Supabase migrations with row-level security and explicit API grants.

The deployed API base is `https://zmlltsytckexrmybvnof.supabase.co/functions/v1/store-api`. See [Frontend integration](docs/FRONTEND_INTEGRATION.md) for route mapping, session handling, checkout flow, and required secrets.
