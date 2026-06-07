# Setup Guide. Getting Your Hetzner Credentials

This MCP talks to three Hetzner surfaces. You need at most two credentials. This guide
is written so a first-time user can follow it without prior knowledge. Take it slowly,
copy each value into a password manager, and never paste a credential into a public place.

## What you need at a glance

| Surface | What it manages | Credential | Required |
|---|---|---|---|
| Cloud | cloud servers, networks, volumes, firewalls, load balancers, IPs, DNS | one Cloud API token | yes, this is the main one |
| Storage Box | backup storage boxes | the SAME Cloud API token | optional, uses the Cloud token |
| Robot | dedicated physical servers, vSwitches | a Robot webservice user and password | only if you use dedicated servers |

If you only use Hetzner Cloud, you need just the Cloud API token. Robot is a separate
product for dedicated servers and most cloud users can skip it.

## 1. Cloud API token (the main credential)

1. Open the Hetzner Cloud Console at https://console.hetzner.com and log in.
2. Choose the project you want to manage, or create one.
3. In the left menu open Security, then the API Tokens tab.
4. Click Generate API Token.
5. Give it a name, for example mcp-token. Choose Read and Write so you can create and
   manage resources. Choose Read only if you want a safe look-but-do-not-touch token.
6. Click Generate and copy the token immediately. Hetzner shows it once only.
7. Store it in your password manager. This single token also works for the Storage Box
   API, you do not need a separate one.

## 2. Robot webservice user (only for dedicated servers)

Robot is a different console from the Cloud Console. Do this only if you have, or plan to
have, physical dedicated servers.

1. Open the Robot console at https://robot.hetzner.com and log in with your Hetzner login.
2. If you see no dedicated servers and no server menu, you are cloud only. Stop here, you
   do not need Robot credentials.
3. If you do have dedicated servers, open the user menu at the top right, then Settings.
4. Open the page named Web service and app settings. In German this is
   Webservice- und App-Einstellungen, and the first tab is Webservice-/App-Benutzer.
5. If it says no webservice user exists yet, that is normal. You will create one now.
6. Type a strong password into New password, and the same again into Repeat new password.
   In German these fields are Neues Passwort and Neues Passwort (wiederholen).
7. Click Create user. In German the button is Benutzer anlegen.
8. The page now shows your webservice username. It looks like #ws+XXXXXXXX. The username
   is assigned by Hetzner, you only chose the password.
9. Copy the username and the password into your password manager.

Note. Managing existing dedicated servers needs nothing more. Only if you later want to
ORDER new dedicated servers through the API do you also enable Ordering on that same
settings page, under the Bestellung tab.

## 3. Give the credentials to the MCP

Create a file named .env in the project root, copy from .env.example, and fill in.

```
HETZNER_CLOUD_TOKEN=your-cloud-api-token
# Robot is optional, only if you use dedicated servers
HETZNER_ROBOT_USER=#ws+XXXXXXXX
HETZNER_ROBOT_PASSWORD=your-robot-password
```

The .env file is git ignored. Never commit it. Never share it. If a token leaks, revoke
it in the console and generate a new one.

## 4. Confirm it works, at zero cost

Every check below is a read. Reads are always free on Hetzner. After you configure the
MCP, ask it to list your servers, list your storage boxes, and, if you set up Robot, list
your dedicated servers. If those return without an authentication error, you are ready.

## Safety and cost

This MCP never creates a resource that costs money without you confirming first, and it
shows you the hourly and monthly price before it does. Listing and reading never cost
anything. See docs/ROADMAP.md for the full cost doctrine.
