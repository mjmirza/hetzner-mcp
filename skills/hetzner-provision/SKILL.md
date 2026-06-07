---
name: hetzner-provision
description: Spin up and tear down complete Hetzner infrastructure end to end through the hetzner-mcp tools, safely, with a live price preview and an explicit confirmation before anything billed. Use when the user wants to provision a server, a full stack, a network, a firewall, storage, or to clean it all up afterward.
---

# Hetzner Provision

This skill turns a request like spin up a small web server into a finished, verified result,
using the hetzner-mcp tools. It is built around two promises. it actually completes the task,
and it never spends money without showing the price and getting an explicit yes.

## Before you start

Confirm the MCP is connected and the Cloud token is present. A quick cloud_list_servers
proves it. If the user wants dedicated servers, confirm the Robot credentials are set.

## The order of operations, free things first

Build from the cheapest, safest pieces toward the billed one, so most of the work is free
and reversible before any charge happens.

1. Gather the requirement. purpose, rough size, region, operating system, how many servers.
2. Read the catalog, all free.
   - cloud_list_server_types to pick a size, for example cx22 for a small box.
   - cloud_list_locations to pick a region, for example nbg1, fsn1, hel1.
   - cloud_list_images to pick an OS, for example ubuntu-24.04.
   - cloud_get_pricing to know the exact cost of the chosen type.
3. Create the free building blocks.
   - An SSH key with cloud_request POST /ssh_keys, or reference an existing one. Free.
   - A private network with cloud_request POST /networks if the design needs one. Free.
   - A firewall with cloud_request POST /firewalls, then rules. Free.
   - A placement group with cloud_request POST /placement_groups if needed. Free.
4. Show the bill before the billed step. State the hourly and monthly price of the server
   from pricing, multiplied by the count, and ask the user to confirm.
5. Create the server, the one billed step, only after the user confirms.
   - cloud_request POST /servers with confirm true, passing server_type, image, location,
     ssh_keys, networks, firewalls, and user_data for cloud-init if provided.
6. Wait and verify. poll the server with cloud_request GET /servers/{id} until status is
   running, then report the public IP and how to connect.
7. Hand back a summary. what was created, the IP, the monthly cost, and the exact teardown
   command for later.

## Cost and safety rules this skill always follows

- Never call a billed create without confirm true, and never set confirm true on the user's
  behalf without showing the price and getting a clear yes in the conversation.
- Prefer the smallest server type that meets the need. cx22 is a fine default for a demo.
- Reads and free creates do not need confirmation. Do those freely.
- For a throwaway test, create then immediately delete, and tell the user the few cents of
  cost if it ran for minutes.

## Teardown, to stop all cost

Deletion is free and stops billing, but it destroys data, so DELETE needs confirm true.
Tear down in reverse order. server first, then unused volumes, load balancers, floating and
primary IPs, then the free pieces if no longer needed. Confirm the server is gone with a
final cloud_list_servers. Remind the user that a deleted server cannot be recovered.

## Dedicated servers and storage boxes

- Dedicated servers live on the Robot surface and are ordered, not instantly created. Use the
  robot tools to inspect existing servers and vSwitches. Ordering new hardware is a billed,
  human decision, never automate it without an explicit instruction.
- Storage boxes are billed. Create with storagebox_request POST /storage_boxes only with
  confirm true and a shown price.

## What good looks like

The user asked for a server and now has a running server with a known IP, knows exactly what
it costs per month, and has the one command to remove it. Nothing was charged that they did
not approve.
