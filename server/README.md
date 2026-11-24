# Temelo server

An optional web service for Temelo, starting with sharing a timetable as a
link (roadmap milestone 14). The app is local-first and works fully without
it: nothing in the phone or web app depends on this server being reachable.

This is the scaffold from milestone 14.4 — a running Spring Boot application
with its database, migrations and tests wired up, and one endpoint. The
share-link API follows in 14.5.

## Stack

- Java 21, Spring Boot 4.2 (Spring Web MVC, Bean Validation, Spring Data JPA)
- PostgreSQL 18, schema owned by Flyway (Hibernate only validates it)
- Maven through the wrapper (`mvnw`, `mvnw.cmd`) — no Maven installation needed
- JUnit 5, MockMvc and Testcontainers for tests

## Requirements

- A JDK 21 on the `PATH` or in `JAVA_HOME`
- Docker (Docker Desktop on Windows/macOS), running — for the development
  database and for the tests

## Running it

From this directory:

```bash
docker compose up -d --wait   # PostgreSQL on 127.0.0.1:5433
./mvnw spring-boot:run        # the server on http://localhost:8080
```

On Windows use `mvnw.cmd` (PowerShell: `.\mvnw.cmd`) in place of `./mvnw`.

`docker compose down` stops the database and keeps its data;
`docker compose down -v` deletes the data as well. The database is published
on port 5433, not 5432, so it cannot collide with a PostgreSQL installed on
the machine; set `TEMELO_DB_PORT` to move it, and the server follows. Its
connection can also be overridden with `SPRING_DATASOURCE_URL`,
`SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`.

Without Compose, `./mvnw spring-boot:test-run` starts the server against a
throwaway PostgreSQL container instead (via Testcontainers) that is removed
when the server stops.

## Tests

```bash
./mvnw test
```

Needs Docker: `TemeloServerApplicationTests` starts the whole application
against a real PostgreSQL container of the same image `compose.yaml` runs.
`HealthControllerTests` is a web-layer test with the database mocked, which
is how the "database down" answers are checked.

## Endpoints

| Method | Path          | Answer |
| ------ | ------------- | ------ |
| `GET`  | `/api/health` | `200 {"status":"UP","database":"UP"}`, or `503` with `DOWN` when PostgreSQL cannot be reached |

The health answer is `Cache-Control: no-store` and names no host, version or
error, because it is public. With the database gone it answers within about
five seconds (the connection timeout), not Hikari's default thirty.

## Layout

```
src/main/java/.../server/
  TemeloServerApplication.java   Spring Boot entry point
  health/                        GET /api/health
src/main/resources/
  application.properties         datasource, JPA and pool settings
src/test/java/.../server/
  TestcontainersConfiguration    the PostgreSQL container for tests
  TestTemeloServerApplication    spring-boot:test-run entry point
compose.yaml                     development PostgreSQL
```

Code is organised by feature (`health/`, later `share/`), not by layer.
