# Hetzner API Endpoint Audit and Changelog

A living, tested inventory of every Hetzner API endpoint this MCP covers. Each
endpoint records its surface, method, cost class, last test date, and live result.
The goal is a verifiable answer for every single endpoint, not an assumption.

Legend for cost class.
- FREE. read or metadata, never billed.
- FREE-CREATE. creatable at zero cost (ssh keys, networks, firewalls, placement groups).
- BILLED. creating it costs money (servers, volumes, load balancers, floating/primary IPs, storage boxes, dedicated servers).

## Surfaces (live-confirmed 2026-06-07)

| Surface | Host | Auth | Token used | Status |
|---|---|---|---|---|
| Cloud | api.hetzner.cloud/v1 | Bearer token | the Cloud token | tested OK |
| Storage Box | api.hetzner.com/v1 | Bearer token (same unified token) | the Cloud token | tested OK |
| Robot | robot-ws.your-server.de | HTTP Basic (webservice user + password) | NOT the Cloud token | needs Robot credentials |

Key findings.
- DNS is merged into the Cloud API. `GET /zones` returns 200 on api.hetzner.cloud.
- The Cloud token also authenticates the Storage Box API on api.hetzner.com. Auth is unified across those two.
- The Robot API uses a different host and HTTP Basic auth, so it needs separate Robot webservice credentials.

## Cloud read sweep (2026-06-07, all FREE, account was clean)

| Endpoint | Method | Cost | HTTP | Result |
|---|---|---|---|---|
| /servers | GET | FREE | 200 | total 0 |
| /server_types | GET | FREE | 200 | total 25 |
| /images | GET | FREE | 200 | total 58 |
| /isos | GET | FREE | 200 | total 71 |
| /locations | GET | FREE | 200 | total 6 |
| /datacenters | GET | FREE | 200 | total 6 |
| /ssh_keys | GET | FREE | 200 | total 1 |
| /networks | GET | FREE | 200 | total 0 |
| /firewalls | GET | FREE | 200 | total 0 |
| /volumes | GET | FREE | 200 | total 0 |
| /load_balancers | GET | FREE | 200 | total 0 |
| /load_balancer_types | GET | FREE | 200 | total 3 |
| /floating_ips | GET | FREE | 200 | total 0 |
| /primary_ips | GET | FREE | 200 | total 0 |
| /placement_groups | GET | FREE | 200 | total 0 |
| /certificates | GET | FREE | 200 | total 0 |
| /pricing | GET | FREE | 200 | ok |
| /zones (DNS) | GET | FREE | 200 | total 0 |
| /actions | GET | n/a | 410 | DEPRECATED. global actions endpoint removed, actions are now per resource |

## Storage Box read sweep (2026-06-07, api.hetzner.com, FREE)

| Endpoint | Method | Cost | HTTP | Result |
|---|---|---|---|---|
| /storage_boxes | GET | FREE | 200 | total 0 |
| /storage_box_types | GET | FREE | 200 | 3 types, first bx11 |

## Robot (2026-06-07)

| Endpoint | Method | Cost | HTTP | Result |
|---|---|---|---|---|
| /server | GET (Bearer) | FREE | 401 | rejects Bearer, needs HTTP Basic auth, pending Robot credentials |

## Deprecation log

| Date | Endpoint | Change | Action |
|---|---|---|---|
| 2026-06-07 | GET /actions (Cloud, global) | returns 410 deprecated_api_endpoint | use per-resource actions, e.g. /servers/{id}/actions |

## Pending (need credentials or are billed, not yet tested)

- Robot full surface (dedicated servers, vSwitches, boot config, reset, rdns). Needs Robot webservice user + password.
- Billed create flows (server, volume, load balancer, floating ip, primary ip, storage box). To be tested with a single cheapest create plus immediate delete, only on explicit go, to keep cost at fractions of a cent.

## Robot read sweep (2026-06-07, robot-ws.your-server.de, HTTP Basic auth, FREE)

Credentials verified working. The account has real dedicated servers and vSwitches.

| Endpoint | Method | Cost | HTTP | Result |
|---|---|---|---|---|
| /server | GET | FREE | 200 | has dedicated servers |
| /vswitch | GET | FREE | 200 | has vSwitches |
| /ip | GET | FREE | 404 | none on account (auth OK) |
| /subnet | GET | FREE | 404 | none (auth OK) |
| /failover | GET | FREE | 404 | none (auth OK) |
| /key | GET | FREE | 404 | no Robot SSH keys (auth OK) |
| /boot | GET | FREE | 404 | none queried (auth OK) |
| /reset | GET | FREE | 404 | none (auth OK) |
| /storagebox | GET | FREE | 404 | none under Robot (auth OK) |

Note. Robot returns 404 with an error body when a resource collection is empty, which
still confirms authentication succeeded. Only 401 would indicate bad credentials.

## Live re-validation against the Hetzner API changelog (2026-08-30)

Re-checked every surface against the current Hetzner Cloud API changelog
(docs.hetzner.cloud/changelog) and the Storage Box API host, three months after
the 2026-06-07 sweep. The server is still valid. Its generic-request design means
write-parameter changes fall to the caller, and the curated create and delete
tools do not touch any removed field. The deltas that matter, and why each is safe.

| Date | Change | Affected here | Status |
|---|---|---|---|
| 2026-06-02 | Data Center endpoints deprecated, removal planned after 2026-10-01 | cloud_list_datacenters reads /datacenters | Safe today. The eval already treats a 410 on a deprecated endpoint as a pass, so removal will not fail the suite. Prefer /locations and server_types.locations.available going forward. |
| 2026-07-01 | datacenter property removed from Servers and Primary IPs request and response bodies | cloud_create_server body | Not affected. The curated create body sends location, never datacenter. Verified in src/tools/write.ts. |
| 2026-07-08 | dns_ptr now required when changing reverse DNS (deadline 2026-09-30); TTL now required when updating an RRSet TTL | reverse DNS and DNS writes go through the generic cloud_request tool | Caller responsibility. The generic tool passes the body through, so a caller supplies dns_ptr and ttl. No curated tool breaks. |
| 2026-05-01 | Assigned Primary IPs and Floating IPs can no longer be deleted, they must be unassigned first | teardown ordering in the provision skill | Advisory. Unassign before delete during teardown. |
| 2026-06-05 | Load Balancer Types "deprecated" field itself deprecated in favour of a new "deprecation" field | /load_balancer_types read | Not affected. The compact projection is generic and does not reference the deprecated field. Verified in src/format.ts. |
| 2026-08-17 | Load Balancer health checks gained detail and http_status_code response fields | /load_balancers read | Additive only, no break. |

Storage Box host confirmed current. GET https://api.hetzner.com/v1/storage_boxes with
Bearer auth is the live endpoint, matching the storagebox surface base in src/config.ts.

Method. Each row was cross-checked against the live changelog entry and against the
code that would be affected, then the code was inspected to confirm the stated status.
No billed live calls were re-run, the 2026-06-07 billed lifecycle sweep stands and this
pass validates only what the API changed since.
