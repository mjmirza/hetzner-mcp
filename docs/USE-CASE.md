# Use Case. Agent-driven ephemeral compute on Hetzner

This use case is grounded in a real, documented community need, not invented. People run
short-lived disposable Hetzner servers for CI jobs and one-off compute because Hetzner is
far cheaper than the hosted alternatives. The friction is that doing it safely and watching
the cost is manual. This MCP lets an AI agent do it with a cost guard.

## The evidence this is a real need

- Self-hosted Hetzner CI runners are a mature pattern with several open-source projects.
  Cyclenerd/hcloud-github-runner, testflows github-hetzner-runners, Kwarf/hetzner-ephemeral-runner,
  and GitLab runner orchestrators. People use these in production.
  https://github.com/Cyclenerd/hcloud-github-runner
  https://github.com/testflows/testflows-github-hetzner-runners
  https://github.com/Kwarf/hetzner-ephemeral-runner
- The driver is cost. Hetzner Cloud runners are reported as up to 75 times cheaper than
  GitHub hosted runners.
  https://altinity.com/blog/ci-cd-bills-using-hetzner-cloud-github-runners-for-clickhouse-builds
- The documented gotcha is hourly rounding. Hetzner rounds usage up to a full hour, so a
  server that lives a few minutes still costs one hour. Naive per-job spin up wastes money.
  Same source as above, and the Hetzner Community GitLab runner tutorial.
  https://community.hetzner.com/tutorials/gitlab-runner-hetzner-cloud/

## How this MCP serves that need

The risky parts of the loop are creating a billed server and forgetting to delete it. The
MCP makes both safe.

- cloud_create_server is billed and refuses to run without confirm true, and it shows the
  live hourly and monthly price first. That makes the hourly rounding cost visible before
  you commit, which is the exact pain above.
- cloud_delete_server stops billing and needs confirm true so it is deliberate.
- Reads are free, so listing types, images, and pricing to choose a spec costs nothing.

## Walkthrough, first time

1. Register the server.
   claude mcp add -s user hetzner -e HETZNER_CLOUD_TOKEN=your-token -- npx -y hetzner-mcp
2. Pick a spec, all free reads.
   cloud_list_server_types to choose a size. cloud_get_pricing to see the cost.
3. Create the disposable server. The tool shows the price and asks for confirm.
   cloud_create_server with name, server_type, image, and confirm true. It returns the id,
   the public IP, and a root password when no SSH key is attached.
4. Use it. SSH in, run your job, copy results out.
5. Destroy it the moment you are done, to stop billing.
   cloud_delete_server with the id and confirm true.

## Why this is not a nice to have

The community already pays for tooling that does this. The gap this fills is doing it from
an AI agent in plain language, with a guard that prevents a runaway bill or a forgotten
server, on an EU provider. That is a real need with a real cost behind it.
