# Backend tests

Integration tests that run the real API against a real Postgres and Redis. They delete everything in the database they connect to, so point them at disposable containers:

```bash
docker run -d --rm --name ts-test-pg -e POSTGRES_USER=t -e POSTGRES_PASSWORD=t -e POSTGRES_DB=t -p 127.0.0.1:55433:5432 postgres:16-alpine
docker run -d --rm --name ts-test-redis -p 127.0.0.1:56379:6379 redis:7-alpine

export TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:55433/t
export TEST_REDIS_URL=redis://127.0.0.1:56379

DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
npm test

docker stop ts-test-pg ts-test-redis
```
