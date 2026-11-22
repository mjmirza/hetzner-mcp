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

## Live re-validation against the Hetzner API changelog (2026-11-22)

Re-checked the server against the Hetzner Cloud API changelog from September
through November 2026 (https://docs.hetzner.cloud/changelog), after the 2026-08-30 pass.
No billed live calls. Each row was checked against the code named in the status. The
2026-06-07 tables above, docs/AUDIT.md (generated 2026-06-08) and the tool results in
docs/VALIDATION.md are left as the record of those runs.

| Date | Change | Affected here | Status |
|---|---|---|---|
| [2026-09-08](https://docs.hetzner.cloud/changelog#2026-09-08-removing-the-deprecated-field), removed [2026-11-02](https://docs.hetzner.cloud/changelog#2026-11-02-removed-the-deprecated-field) | Response field `deprecated` removed from endpoints that return Images, Server Types and Load Balancer Types. Use `deprecation`. Null means not deprecated. | src/map/actions.ts image list for map create | Updated. The filter was `!i.deprecated && !i.deprecation`. The `deprecated` half can no longer match a live response, so it was removed. Images with a `deprecation` object are still left out. Server type retirement already reads `locations[].deprecation` in src/tools/capacity.ts. The compact projection does not read `deprecated`. Verified in src/format.ts. |
| [2026-09-09](https://docs.hetzner.cloud/changelog#2026-09-09-object-storage-new-delete-rule) | A Bucket may be deleted with up to 1,000 leftover multipart parts. Other objects must still be removed. Deleting a project still requires every Bucket to be empty. | Object Storage | Not affected. This server has no Bucket tools. |
| [2026-09-15](https://docs.hetzner.cloud/changelog#2026-09-15-network-members-endpoint) | New `GET /networks/{id}/members` lists resources attached to a network. | cloud_list_network_members | Already covered. The tool is registered in src/tools/resources.ts (added in 0.5.0). The map still reads `network.servers` and load balancer `private_net`, which those resources still return. |
| [2026-09-23](https://docs.hetzner.cloud/changelog#2026-09-23-primary-ips-unassigned) | An unassigned Primary IP now returns `assignee_type` `unassigned` with `assignee_id` null. Before, `assignee_type` was `server` while `assignee_id` was null. | src/map/collect.ts primary IPs | Not a break. A link is drawn only when `assignee_type` is `server` and `assignee_id` is set. The unassigned flag keys off a missing `assignee_id`, so both the new and the old form stay unassigned. The sample unassigned address uses `unassigned`. |
| [2026-09-30](https://docs.hetzner.cloud/changelog#2026-09-30-zone-ttl-omit-removed) | `ttl` is now required on `POST /zones/{id}/rrsets/{name}/{type}/actions/change_ttl`. Announced 2026-07-08. | DNS writes | Caller responsibility. No curated tool writes a record-set TTL. `cloud_request` passes the body through, so the caller sends `ttl` or `null`. |
| [2026-09-30](https://docs.hetzner.cloud/changelog#2026-09-30-dns-ptr-omit-removed) | `dns_ptr` is now required when changing reverse DNS on a Server, Primary IP, Floating IP or Load Balancer. Announced 2026-07-08. | reverse DNS writes | Caller responsibility. No curated tool sends `change_dns_ptr`. `cloud_request` passes the body through, so the caller sends `dns_ptr` or `null`. |
| [2026-10-01](https://docs.hetzner.cloud/changelog#2026-10-01-datacenters-removed) | `GET /datacenters` and `GET /datacenters/{id}` return HTTP 410. | cloud_list_datacenters | Already removed in 0.5.0. It is not in src/tools/resources.ts, and test/eval.ts no longer calls `/datacenters`. docs/VALIDATION.md still lists the tool as passed, and docs/AUDIT.md still shows `datacenters` 200 from 2026-06-08. Those are the earlier runs, not the current tool list. Use `cloud_list_locations` or `find_capacity`. |
| [2026-10-05](https://docs.hetzner.cloud/changelog#2026-10-05-delete-load-balancer-returns-action) | `DELETE /load_balancers/{id}` returns 201 with an Action, instead of 204 with an empty body. | cloud_delete_load_balancer and map delete | Not a break. src/http.ts accepts any status below 300 and parses the body. The curated delete and the map delete pass that body to `waitForActions`, which reads `action` (src/actions.ts). A 204 with no body still means there is nothing to wait for. |
| [2026-10-12](https://docs.hetzner.cloud/changelog#2026-10-12-link-header-deprecation) | HTTP `Link` pagination headers are deprecated and will be removed on 1 April 2027. Use `meta.pagination`. | list pagination | Not affected. Page walks use `meta.pagination.next_page` in src/map/collect.ts, src/format.ts and src/tools/capacity.ts. No code reads a Link header. |
| [2026-10-15](https://docs.hetzner.cloud/changelog#2026-10-15-server-subnet-type-deprecation) | Network subnet type `server` is deprecated and will be removed on 15 April 2027. It is equivalent to `cloud`. Existing subnets keep their type. | network create | The map creates subnets with type `cloud` (src/map/actions.ts). `cloud_create_network` passes `subnets` through, and its description now tells callers to use type `cloud`. |
| [2026-10-27](https://docs.hetzner.cloud/changelog#2026-10-27-volumes-allow-generic-resource-targets) | `POST /volumes`, `GET /volumes`, `GET /volumes/{id}` and `POST /volumes/{id}/actions/attach` gain `assignee`. `server` is deprecated and will be removed on 27 October 2027. After that, create or attach with `server` fails. | cloud_create_volume, cloud_attach_volume, map volume create and reads | Updated. Callers still pass a server id. The request sends `assignee: { id, type: "server" }` and does not send `server`. Reads prefer `assignee` and use `server` only when `assignee` is absent. The shape is `{ id: integer, type: string }` on the request, and that object or null on the response, from https://docs.hetzner.cloud/cloud.spec.json (CreateVolumeRequest, AttachVolumeRequest, Volume). The reference is https://docs.hetzner.cloud/reference/cloud. A server delete still reads `server.volumes`, the list of volume ids on the Server, which that spec still documents. Verified in src/tools/delete-preview.ts. |
| [2026-11-12](https://docs.hetzner.cloud/changelog#2026-11-12-fedora-43-image-is-deprecated) | Image `fedora-43` (ids 342035601 x86 and 342035605 arm) is deprecated and will not be offered for new servers after 12 February 2027. | map create image list | No name is hardcoded. The list drops an image whose `deprecation` field is set, which is how Hetzner marks a deprecated image. `cloud_list_images` still returns the image so a caller can see it. |

Method. Same as the 2026-08-30 pass: each row was read from the changelog, then the code
that would send or read the field was inspected. No billed call was made.
