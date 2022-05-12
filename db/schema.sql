DROP TABLE IF EXISTS accounts
CASCADE;

DROP DOMAIN IF EXISTS EMAILTYPE;

DROP TYPE IF EXISTS USERTYPE;

CREATE DOMAIN EMAILTYPE AS TEXT
CHECK(
    VALUE ~ '^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,24})+$'
);

CREATE TYPE USERTYPE AS ENUM ('admin', 'standard');

CREATE TABLE IF NOT EXISTS accounts
(
    id SERIAL PRIMARY KEY NOT NULL,
    username VARCHAR NOT NULL,
    email EMAILTYPE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone INTEGER NOT NULL,
    plan USERTYPE NOT NULL
);

insert into accounts
  ( username, email, password, phone, plan)
values
  (
    'anelmes0',
    'example@examples.com',
    '$2a$10$cSqXaVNoq2ByNV05NgyRG.oat5iWHKijdSiMSZP3rYlzmy3BEyN66',
    16900,
    'standard'
  );