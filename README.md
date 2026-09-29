# Kynox Estate Bot

A Discord server bot for Kynox Estate RP with staff moderation, private support tickets, application forms, review decisions, and case records.

## Requirements

- Node.js 20.11 or newer
- A Discord application and bot token
- A server where you can install the bot and configure its roles/channels

## Setup

1. In the Discord Developer Portal, create an application, add a bot, and copy its token and application ID.
2. Invite the bot with the `bot` and `applications.commands` scopes. Grant it View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Channels, Manage Roles, Manage Messages, Moderate Members, Kick Members, and Ban Members as needed. Keep its role above members it must moderate and above both verification roles.
3. In the Discord Developer Portal, open **Bot > Privileged Gateway Intents** and enable **Server Members Intent** and **Message Content Intent**. The bot uses these to detect joins and receive plain-text application replies in DMs.
4. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`. Set `GUILD_ID` while testing to register commands immediately in one server.
5. Add the IDs for your staff role, moderation log, ticket category, ticket transcript log, and application review channel. Optional routing IDs can be left blank, but application review requires `APPLICATION_REVIEW_CHANNEL_ID`.
6. Install and build:

   ```sh
   npm install
   npm run build
   ```

7. Register commands and start the bot:

   ```sh
   npm run deploy
   npm start
   ```

For local development, use `npm run dev`. Without `GUILD_ID`, commands are registered globally and can take time to appear.

## Commands

- `/help` shows the command guide.
- `/property-map` posts the Liberty County property map as the embed's large image, with Kynox/Kapri ownership and Fairview, Riverside, and Maplewood details. Place the supplied image at `assets/property-map.png`.
- `/resources` posts a branded embed linking to the Kynox Estate legal documents folder.
- `/verify` is available to every server member and assigns the configured member roles; the welcome-message verification button remains available too.
- `/greet user [message]` posts a Kynox Estate greeting with a team signature.
- `/showing request property preferred_time [details]` posts a house showing request in channel `1554252002173919272` and pings the configured showing team role.
- `/mod warn user reason` sends a warning by DM when possible and creates a case.
- `/mod timeout user minutes reason` applies a Discord timeout (1-40320 minutes).
- `/mod kick user reason`, `/mod ban user reason`, and `/mod unban user_id reason` manage membership.
- `/mod purge amount` deletes 1-100 recent messages; `/mod lock` and `/mod unlock` control the current channel.
- `/mod case case_id` and `/mod cases user` display case history to moderators.
- `/ticket panel` posts a ticket button. Tickets are private to the opener, configured staff, and the configured support role. Support staff can claim tickets; the opener or support staff can close them. Closing uploads a text transcript when a ticket log channel is configured, then deletes the ticket channel.
- `/application panel [channel]` posts Staff and Housing application buttons. Applicants receive eight staff or twelve housing real-estate roleplay questions in DMs, one at a time, and reply with ordinary DM messages. Completed answers go to the configured review channel; staff can approve or reject from the review message. Acceptance posts a notification and pings the applicant in channel `1554251916110725230`, as well as sending them a DM when possible.

The configured `STAFF_ROLE_ID` or Discord `Manage Server` permission grants access to staff panels and application decisions. `SUPPORT_ROLE_ID` grants ticket visibility, claims, and closes. Moderation actions additionally require the matching Discord permission. Keep the bot's role hierarchy and channel overwrites configured correctly.

Every slash-command invocation is audited in channel `1554252380776702013`, including the command, user, server, channel, and supplied options. Moderation actions also create detailed case entries in that channel.

When someone joins, the bot posts a welcome and verification button in channel `1554251423590522880`. Pressing **Verify and Join** assigns roles `1554254120972451910` and `1554254552809734154` if they are not already present. The bot must have Manage Roles permission, both roles must exist in the same server, and its highest role must be above both of them.

Applications are based on fictional roleplay information. Do not submit real-world financial, identity, or other sensitive personal information. Members must allow server DMs to receive the application questions and reply in that DM.

## Data and privacy

Cases, active/closed ticket metadata, and application status are stored in `data/kynox-data.json` on the host. Ticket transcript contents are sent only to the configured ticket log channel. Back up this file when moving the bot, restrict access to it, and follow your community's retention and privacy rules. The bot processes the most recent 100 ticket messages for a transcript.

## Notes

- This project intentionally does not include a real token, server IDs, branding image, or hosting credentials. Set your own values in `.env`; never share or commit that file.
- Keep the process running on a trusted host for the bot to stay online.