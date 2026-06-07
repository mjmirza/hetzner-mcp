# Cheat Sheet

A one-page reference for the hetzner-mcp tools and surfaces, and how it compares.

## Surfaces

| Surface | Host | Auth | Manages |
|---|---|---|---|
| Cloud | api.hetzner.cloud/v1 | Bearer token | servers, networks, volumes, firewalls, load balancers, floating and primary IPs, placement groups, SSH keys, images, certificates, DNS zones |
| Storage Box | api.hetzner.com/v1 | same Bearer token | storage boxes |
| Robot | robot-ws.your-server.de | HTTP Basic | dedicated servers, vSwitches, IPs, subnets, rDNS |

## Generic tools, complete coverage

| Tool | Use |
|---|---|
| cloud_request | any Cloud endpoint, method plus relative path |
| storagebox_request | any Storage Box endpoint |
| robot_request | any Robot endpoint |

Arguments. method default GET, path like /servers, optional query, optional body, confirm for
billed creates, verbose for full payload.

## Curated read tools, free and compact

cloud_list_servers, cloud_list_ssh_keys, cloud_list_networks, cloud_list_firewalls,
cloud_list_volumes, cloud_list_load_balancers, cloud_list_load_balancer_types,
cloud_list_floating_ips, cloud_list_primary_ips, cloud_list_placement_groups,
cloud_list_certificates, cloud_list_images, cloud_list_isos, cloud_list_dns_zones,
cloud_list_server_types, cloud_list_locations, cloud_list_datacenters, cloud_get_pricing,
storagebox_list, storagebox_list_types, robot_list_servers, robot_list_ips,
robot_list_subnets, robot_list_vswitches, robot_list_failover, robot_list_ssh_keys,
robot_list_storageboxes, robot_list_rdns. Plus contribute_or_report.

## Safety quick rules

| Action | Cost | Needs confirm |
|---|---|---|
| any list or get | free | no |
| create SSH key, network, firewall, placement group | free | no |
| create server, volume, load balancer, floating or primary IP, storage box | billed | yes, plus price shown |
| DELETE anything | free, stops billing | yes, data loss guard |
| any write in read-only mode | n/a | refused |

## How it compares to other Hetzner MCP servers

| Project | Surfaces | Cost guard | Live endpoint audit | Token-efficient | Contribution loop |
|---|---|---|---|---|---|
| hetzner-mcp, this one | Cloud, Storage Box, Robot | yes, with price preview and destructive guard | yes, 39 of 39 | yes, compact plus cap | yes |
| dkruyt/mcp-hetzner | Cloud | not documented | not documented | not documented | no |
| Xodus-CO/hcloud-mcp | Cloud | not documented | not documented | not documented | no |
| lazyants/hetzner-mcp-server | Cloud | not documented | not documented | not documented | no |
| MahdadGhasemian/mcp-hetzner-go | Cloud | not documented | not documented | not documented | no |
| valerius21/hetzner-mcp | Cloud | not documented | not documented | not documented | no |
| nityeshaga/hetzner-mcp-server | Cloud | not documented | not documented | not documented | no |

Comparison reflects public READMEs as of 2026-06-07. If a project adds a capability, this
table should be corrected by a pull request.
