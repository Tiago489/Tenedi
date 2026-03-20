# Tenet EDI Transform Service

Production-grade EDI ↔ JSON transformation service. Hybrid architecture: TypeScript engine for all EDI processing, Django ops platform for management.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│               Inbound Sources                            │
│       REST API      SFTP Poller      AS2 Receiver        │
└──────────┬──────────────┬──────────────┬─────────────────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────────────────────────────────────────────────┐
│            BullMQ — edi:inbound queue                    │
└─────────────────────┬────────────────────────────────────┘
                      │
           ┌──────────▼──────────┐
           │  Inbound Workers×4  │
           │  1. Parse EDI→JEDI  │
           │  2. JEDI→System JSON│
           │  3. Deliver to API  │
           │  4. Generate 997    │
           └──────────┬──────────┘
                      │ 997 ACK
           ┌──────────▼──────────┐
           │  edi:outbound queue │
           └──────────┬──────────┘
                      │
           ┌──────────▼──────────┐
           │  Outbound Workers×2 │
           │  System JSON→JEDI   │
           │  Serialize→EDI      │
           │  Route (SFTP / AS2) │
           └─────────────────────┘

┌──────────────────────────────────────────────────────────┐
│          Django Ops Platform  :8000/admin                │
│  Partners | Map Registry | Job Monitor | AI DSL Gen      │
└──────────────────┬───────────────────────────────────────┘
                   ↕ Shared Postgres + REST API
┌──────────────────────────────────────────────────────────┐
│       TypeScript Engine REST API  :3000                  │
└──────────────────────────────────────────────────────────┘
```

**Design rationale:** All EDI is parsed to JEDI (JSON-EDI) canonical format first. Maps never touch raw EDI — they transform JEDI ↔ system JSON. This decouples parsing from mapping and enables zero-downtime map deployments via atomic in-memory pointer swap in the Node.js runtime.

## Quick Start

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, DJANGO_SECRET_KEY, ANTHROPIC_API_KEY

docker-compose up -d

# Create Django superuser (first time only)
docker-compose exec ops python manage.py createsuperuser
```

Services:
- Engine API: http://localhost:3000
- Ops Platform (Django Admin): http://localhost:8000/admin
- Redis: localhost:6379
- Postgres: localhost:5432
- SFTP: localhost:2222

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Engine HTTP port |
| `AS2_PORT` | `4080` | AS2 receiver port |
| `REDIS_URL` | `redis://redis:6379` | BullMQ / Celery broker |
| `DATABASE_URL` | — | PostgreSQL DSN |
| `SFTP_HOST` | — | SFTP server hostname |
| `SFTP_POLL_INTERVAL_MS` | `30000` | SFTP poll frequency |
| `AS2_SENDER_ID` | — | Your AS2 identifier |
| `ROUTING_RULES` | `[]` | JSON array of downstream routing rules |
| `MAPS_DB_PATH` | `./maps/db` | Map JSON persistence directory |
| `ENGINE_API_URL` | `http://engine:3000` | Engine URL (for Django) |
| `ANTHROPIC_API_KEY` | — | Claude API key for AI DSL generation |
| `DJANGO_SECRET_KEY` | — | Django secret key |

## How to Publish a Map

1. **Author DSL** in Django Admin → Maps → Transform Maps. Write DSL using Tier 1 keywords.
   Or use the AI generation endpoint: `POST /api/maps/transform-maps/generate-dsl/`
2. **Compile & Publish** — select the map, run the "Compile & Publish" action.
   This calls `POST /maps/compile` on the engine, validates against a JEDI fixture, then calls `POST /maps`.
3. **Live** — the engine performs an atomic pointer swap. New jobs pick up the new map immediately.
   In-flight jobs continue with the version they captured at start.
4. **Rollback** — use `POST /maps/rollback` or the engine API if needed.

## DSL Keyword Reference

### Tier 1 — AI-Generatable

| Keyword | Syntax | Description |
|---|---|---|
| `$map` | `$map <src> to <tgt> [$as modifier]` | Field assignment |
| `$if` | `$if <src> present [to <tgt>] [$else ...]` | Existence guard |
| `$if` | `$if <src> equals "<v>" [to <tgt>] [$else ...]` | Equality condition |
| `$else` | `$else $omit` \| `$else "<default>"` | Fallback (omit or static) |
| `$concat` | `$concat "<sep>" <s1> <s2> ... to <tgt>` | String join |
| `$lookup` | `$lookup <TableName> <src> to <tgt>` | Reference table lookup |
| `$overwrite` | `$overwrite <src> to <tgt>` | Collapse array to last value |
| `$as` | modifier on `$map` or standalone `$as <mod> <src> to <tgt>` | Type coercion |
| `$sum-of` | `$sum-of <src> to <tgt>` | Sum array elements |
| `$substring` | `$substring <src> <start> <len> to <tgt>` | Substring extraction |

### Tier 2 — `$as` Modifiers

| Modifier | Compiles to | Description |
|---|---|---|
| `string` | `$string(x)` | Coerce to string |
| `number` | `$number(x)` | Coerce to number |
| `date` | `$toMillis(x, "[Y0001][M01][D01]")` | Parse YYYYMMDD date |
| `uppercase` | `$uppercase(x)` | Uppercase |
| `trimmed` | `$trim(x)` | Trim whitespace |
| `timestamp` | `$now()` | Current ISO timestamp |

### Tier 3 — Escape Hatch (Human-Only)

| Keyword | Syntax | Notes |
|---|---|---|
| `$expr` | `$expr <tgt> "<raw JSONata>"` | Pass-through verbatim JSONata. **Never AI-generated.** Validated at compile time. |

## Adding a New DSL Keyword

1. Create `engine/src/dsl/keywords/my-keyword.ts` implementing the `DSLKeyword` interface
2. Add `.register(myKeyword)` to `engine/src/dsl/keywords/index.ts`
3. Set `aiGeneratable: true | false`
4. Write tests in `engine/tests/dsl/compiler.test.ts`
5. Rebuild — the keyword is available immediately. No restart needed.

## Supported Transaction Sets

| Set | Description | Direction |
|---|---|---|
| 204 | Motor Carrier Load Tender | Inbound |
| 210 | Motor Carrier Freight Bill | Inbound |
| 211 | Motor Carrier Bill of Lading | Inbound |
| 214 | Shipment Status Message | Inbound |
| 990 | Response to Load Tender | Outbound |
| 997 | Functional Acknowledgment | Auto-generated |

## Engine API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/edi/inbound` | Submit raw EDI (`application/edi-x12`) |
| `POST` | `/edi/inbound/file` | Upload EDI file (multipart) |
| `GET` | `/edi/inbound/status/:jobId` | Job status |
| `POST` | `/edi/outbound/:txSet` | Submit system JSON for outbound (990, 214, 210) |
| `GET` | `/maps` | List active maps |
| `POST` | `/maps` | Publish new map (immediate atomic swap) |
| `POST` | `/maps/rollback` | Rollback to version |
| `POST` | `/maps/compile` | Compile + validate DSL |
| `GET` | `/maps/vocabulary` | AI-generatable keyword tokens |
| `POST` | `/as2/receive` | AS2 receive endpoint |
| `GET` | `/health` | Health check |

## Scaling Workers

Workers are stateless. Increase replicas in `docker-compose.yml`:

```yaml
worker-inbound:
  deploy:
    replicas: 8   # scale up for higher inbound throughput

worker-outbound:
  deploy:
    replicas: 4
```

Rate limiter is set to 100 jobs/sec on the inbound worker. Adjust in [src/queue/workers/inbound.ts](engine/src/queue/workers/inbound.ts).

> **Note:** The SFTP `seenFiles` dedup set is in-memory. For multi-instance SFTP polling,
> back it with Redis. See the TODO in [src/connectors/sftp.ts](engine/src/connectors/sftp.ts).

## Running Tests

```bash
cd engine
npm install
npm test
```
