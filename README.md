# Sign in / dashboard

Small Express + Postgres app: sign up, get taken straight to a dashboard, sign out, sign back in.

## Run everything with Docker

```bash
docker compose up --build
```

Open http://localhost:3001. The app creates the `users` table on startup, so there are no migrations to run.

The host port is 3001 because 3000 is commonly taken by other dev servers; the app itself still listens on 3000 inside its container. Change the `app` ports mapping in `docker-compose.yml` if you want a different one.

Stop it with `docker compose down` (add `-v` to also delete the database volume).

## Run the app locally, Postgres in Docker

```bash
npm install
docker compose up -d db
npm start
```

This serves on http://localhost:3000. If that port is busy, run `PORT=3002 npm start` (bash) instead.

## Configuration

| Variable         | Default              |
| ---------------- | -------------------- |
| `PORT`           | `3000`               |
| `PGHOST`         | `localhost`          |
| `PGPORT`         | `5432`               |
| `PGUSER`         | `app`                |
| `PGPASSWORD`     | `app`                |
| `PGDATABASE`     | `app`                |
| `SESSION_SECRET` | dev placeholder      |

Passwords are hashed with bcrypt; sessions are stored in memory, so a restart signs everyone out. Set `SESSION_SECRET` to something random outside local development.
