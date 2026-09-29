import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the Kynox Estate bot command guide."),
  new SlashCommandBuilder()
    .setName("resources")
    .setDescription("Post the Kynox Estate legal documents and resources."),
  new SlashCommandBuilder()
    .setName("property-map")
    .setDescription("Show the Kynox Estate Liberty County property map."),
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify your membership and receive the member roles."),
  new SlashCommandBuilder()
    .setName("greet")
    .setDescription("Send a signed Kynox Estate greeting to a member.")
    .addUserOption((option) => option.setName("user").setDescription("Member to greet.").setRequired(true))
    .addStringOption((option) => option.setName("message").setDescription("Optional personal note.").setMaxLength(500)),
  new SlashCommandBuilder()
    .setName("showing")
    .setDescription("Request a house showing with Kynox Estate.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("request")
        .setDescription("Submit a property showing request.")
        .addStringOption((option) => option.setName("property").setDescription("Property address or listing name.").setMaxLength(200).setRequired(true))
        .addStringOption((option) => option.setName("preferred_time").setDescription("Your preferred date and time for the showing.").setMaxLength(100).setRequired(true))
        .addStringOption((option) => option.setName("details").setDescription("Optional notes for the showing team.").setMaxLength(800)),
    ),
  new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Moderation tools for authorized staff.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("warn")
        .setDescription("Issue a formal warning.")
        .addUserOption((option) => option.setName("user").setDescription("Member to warn.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason for this action.").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("timeout")
        .setDescription("Temporarily prevent a member from chatting.")
        .addUserOption((option) => option.setName("user").setDescription("Member to timeout.").setRequired(true))
        .addIntegerOption((option) => option.setName("minutes").setDescription("Duration in minutes (1-40320).").setMinValue(1).setMaxValue(40320).setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason for this action.").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("kick")
        .setDescription("Remove a member from the server.")
        .addUserOption((option) => option.setName("user").setDescription("Member to kick.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason for this action.").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ban")
        .setDescription("Ban a member from the server.")
        .addUserOption((option) => option.setName("user").setDescription("Member to ban.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason for this action.").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unban")
        .setDescription("Unban a user by Discord ID.")
        .addStringOption((option) => option.setName("user_id").setDescription("Discord user ID.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason for this action.").setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("purge")
        .setDescription("Bulk-delete recent messages (1-100).")
        .addIntegerOption((option) => option.setName("amount").setDescription("Number of messages.").setMinValue(1).setMaxValue(100).setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("lock")
        .setDescription("Prevent members from sending messages in this channel.")
        .addStringOption((option) => option.setName("reason").setDescription("Reason for locking the channel.")),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unlock")
        .setDescription("Allow members to send messages in this channel again."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("case")
        .setDescription("View a moderation case by its ID.")
        .addIntegerOption((option) => option.setName("case_id").setDescription("Case number.").setMinValue(1).setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cases")
        .setDescription("View recent moderation cases for a member.")
        .addUserOption((option) => option.setName("user").setDescription("Member to look up.").setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create and manage private support tickets.")
    .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("Post the support ticket panel here."))
    .addSubcommand((subcommand) => subcommand.setName("claim").setDescription("Claim the ticket in this channel."))
    .addSubcommand((subcommand) => subcommand.setName("close").setDescription("Close the ticket in this channel.")),
  new SlashCommandBuilder()
    .setName("application")
    .setDescription("Post application forms or review submissions.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("panel")
        .setDescription("Post staff and community application buttons here.")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel for the application panel.").addChannelTypes(ChannelType.GuildText)),
    ),
].map((command) => command.toJSON());

export const permissionByAction = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  purge: PermissionFlagsBits.ManageMessages,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
} as const;