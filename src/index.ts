import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
  type Interaction,
  type Message,
  type NewsChannel,
  type TextChannel,
  type User,
} from "discord.js";
import { lock } from "proper-lockfile";
import { config, validateConfig } from "./config.js";
import { permissionByAction } from "./commands.js";
import { store } from "./store.js";

validateConfig();
let releaseBotLock: () => Promise<void>;
try {
  releaseBotLock = await lock(fileURLToPath(new URL("../", import.meta.url)), {
    realpath: false,
    stale: 30_000,
    update: 10_000,
    retries: 0,
  });
} catch (error) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ELOCKED") {
    console.error("Kynox Estate Bot is already running from this project directory. Exiting this duplicate instance.");
    process.exit(0);
  }
  throw error;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});
const colors = { green: 0x3ba55d, red: 0xed4245, gold: 0xc49a55, ink: 0x20252b };
const presenceActivities = [
  { name: "Broward County Roleplay", type: ActivityType.Watching },
  { name: "Kynox Estate | Community First", type: ActivityType.Playing },
  { name: "Applications & Support", type: ActivityType.Listening },
  { name: "Building the Kynox community", type: ActivityType.Watching },
];
type ApplicationKind = "staff" | "community";
type ApplicationSession = {
  guildId: string;
  kind: ApplicationKind;
  answers: string[];
  questionIndex: number;
  startedAt: number;
  busy: boolean;
};
const applicationSessions = new Map<string, ApplicationSession>();

function hasRole(interaction: ChatInputCommandInteraction | ButtonInteraction, roleId: string): boolean {
  if (!roleId) return false;
  const member = interaction.member;
  if (!member) return false;
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return member.roles.cache.has(roleId);
}

function isStaff(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true || hasRole(interaction, config.staffRoleId);
}

function isSupportStaff(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
  return isStaff(interaction) || hasRole(interaction, config.supportRoleId);
}

function makeCaseEmbed(caseId: number, action: string, actor: User, target: User, reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle(`Moderation Case #${caseId}`)
    .addFields(
      { name: "Action", value: action, inline: true },
      { name: "Member", value: `${target.tag} (${target.id})`, inline: true },
      { name: "Moderator", value: `${actor.tag} (${actor.id})`, inline: true },
      { name: "Reason", value: reason.slice(0, 1024) },
    )
    .setTimestamp();
}

async function logSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const logChannel = await client.channels.fetch(config.modLogChannelId).catch(() => null);
  if (!logChannel?.isTextBased() || !("send" in logChannel)) {
    console.warn(`Slash-command audit channel ${config.modLogChannelId} is unavailable or not a text channel.`);
    return;
  }
  const details = JSON.stringify(interaction.options.data.map((option) => ({
    name: option.name,
    value: "value" in option ? option.value : undefined,
    options: "options" in option
      ? option.options?.map((child) => ({ name: child.name, value: "value" in child ? child.value : undefined }))
      : undefined,
  }))).slice(0, 1024);
  const embed = new EmbedBuilder()
    .setColor(colors.ink)
    .setTitle("Slash Command Used")
    .addFields(
      { name: "Command", value: `/${interaction.commandName}`, inline: true },
      { name: "User", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
      { name: "Server", value: interaction.guild ? `${interaction.guild.name} (${interaction.guildId})` : "Direct message", inline: false },
      { name: "Channel", value: interaction.channelId ? `<#${interaction.channelId}>` : "Unavailable", inline: true },
      { name: "Options", value: details || "None", inline: false },
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function logCase(interaction: ChatInputCommandInteraction, action: string, target: User, reason: string): Promise<number> {
  const record = store.addCase({
    guildId: interaction.guildId!,
    moderatorId: interaction.user.id,
    userId: target.id,
    action,
    reason,
  });
  const logChannel = config.modLogChannelId
    ? await interaction.guild?.channels.fetch(config.modLogChannelId).catch(() => null)
    : null;
  if (logChannel?.isTextBased()) {
    await logChannel.send({ embeds: [makeCaseEmbed(record.id, action, interaction.user, target, reason)] })
      .catch((error: unknown) => console.warn("Could not send moderation log:", error));
  }
  return record.id;
}

async function requireActionPermission(interaction: ChatInputCommandInteraction, action: keyof typeof permissionByAction): Promise<boolean> {
  const required = permissionByAction[action];
  if (interaction.memberPermissions?.has(required) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({ content: `You need the ${action} permission to use this action.`, ephemeral: true });
  return false;
}

function getTicketChannel(interaction: ChatInputCommandInteraction | ButtonInteraction): TextChannel | NewsChannel | null {
  const channel = interaction.channel;
  if (!channel || channel.isDMBased() || !channel.isTextBased() || !("permissionOverwrites" in channel)) return null;
  return channel as TextChannel | NewsChannel;
}

async function createTicket(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  const existing = store.getOpenTicket(guild.id, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, ephemeral: true });
    return;
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
  ];
  const ticketStaffRoleIds = [...new Set([config.staffRoleId, config.supportRoleId].filter(Boolean))];
  for (const roleId of ticketStaffRoleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  if (guild.members.me) {
    overwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 18)}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || undefined,
    topic: `Kynox support ticket | opener:${interaction.user.id}`,
    permissionOverwrites: overwrites,
  });
  store.addTicket({ channelId: channel.id, guildId: guild.id, openerId: interaction.user.id, claimedBy: null, status: "open", createdAt: new Date().toISOString() });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `${interaction.user}${ticketStaffRoleIds.map((roleId) => ` <@&${roleId}>`).join("")}`,
    embeds: [new EmbedBuilder().setColor(colors.ink).setTitle("Kynox Estate Support").setDescription("A staff member will be with you shortly. Share the details we need to help, and please keep this channel focused on your request.")],
    components: [controls],
    allowedMentions: { users: [interaction.user.id], roles: ticketStaffRoleIds },
  });
  await interaction.reply({ content: `Your private ticket is ready: ${channel}`, ephemeral: true });
}

async function closeTicket(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const channel = getTicketChannel(interaction);
  const ticket = channel && store.getTicket(channel.id);
  if (!channel || !ticket || ticket.status !== "open") {
    await interaction.reply({ content: "This channel is not an open Kynox ticket.", ephemeral: true });
    return;
  }
  if (interaction.user.id !== ticket.openerId && !isSupportStaff(interaction)) {
    await interaction.reply({ content: "Only the ticket opener or staff can close this ticket.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (messages) {
    const transcript = [...messages.values()]
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map((message) => `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag}: ${message.cleanContent || "[attachment/embed]"}`)
      .join("\n");
    const file = new AttachmentBuilder(Buffer.from(transcript || "No messages recorded.", "utf8"), { name: `ticket-${ticket.channelId}-transcript.txt` });
    const logChannel = config.ticketLogChannelId ? await interaction.guild?.channels.fetch(config.ticketLogChannelId).catch(() => null) : null;
    if (logChannel?.isTextBased()) await logChannel.send({ content: `Ticket transcript for <#${channel.id}> (opened by <@${ticket.openerId}>).`, files: [file] });
  }
  store.updateTicket(channel.id, { status: "closed" });
  await channel.delete(`Ticket closed by ${interaction.user.tag}`);
  await interaction.editReply({ content: `Ticket closed and deleted.${config.ticketLogChannelId ? " Its transcript was sent to the ticket log." : " No transcript log channel is configured."}` });
}

async function claimTicket(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
  const channel = getTicketChannel(interaction);
  const ticket = channel && store.getTicket(channel.id);
  if (!channel || !ticket || ticket.status !== "open") {
    await interaction.reply({ content: "This channel is not an open Kynox ticket.", ephemeral: true });
    return;
  }
  if (!isSupportStaff(interaction)) {
    await interaction.reply({ content: "Only configured staff can claim tickets.", ephemeral: true });
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    return;
  }
  store.updateTicket(channel.id, { claimedBy: interaction.user.id });
  await interaction.reply({ content: `Ticket claimed by ${interaction.user}.` });
}

function applicationKindLabel(kind: ApplicationKind): string {
  return kind === "staff" ? "Staff" : "Housing";
}

function applicationPanel(): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("application:start:staff").setLabel("Staff Application").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("application:start:community").setLabel("Housing Application").setStyle(ButtonStyle.Secondary),
  );
  return {
    embeds: [new EmbedBuilder().setColor(colors.gold).setTitle("Kynox Estate | Applications").setDescription("Choose a staff or housing application. Questions are delivered and answered privately through direct messages. Housing applications should use fictional roleplay details only; never send real financial or identity information.")],
    components: [row],
  };
}

async function welcomeNewMember(member: GuildMember): Promise<void> {
  const channel = await member.client.channels.fetch(config.welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    console.warn(`Welcome channel ${config.welcomeChannelId} is unavailable or not a text channel.`);
    return;
  }
  const verifyButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verification:verify").setLabel("Verify and Join").setStyle(ButtonStyle.Success),
  );
  const welcomeEmbed = new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle("Welcome to Kynox Estate")
    .setDescription(`Welcome, ${member.user}! You are joining **Broward County Roleplay**.\n\nPress **Verify and Join** below to complete verification and unlock the member roles.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: "Kynox Estate | Broward County Roleplay" })
    .setTimestamp();
  await channel.send({
    embeds: [welcomeEmbed],
    components: [verifyButton],
    allowedMentions: { users: [member.id] },
  });
}

async function verifyMember(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: "Verification is only available in the Kynox Estate server.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: "I could not find your server membership. Please try again or contact staff." });
    return;
  }
  const rolesToAdd = config.verifiedRoleIds.filter((roleId) => !member.roles.cache.has(roleId));
  if (!rolesToAdd.length) {
    await interaction.editReply({ content: "You are already verified. Welcome to Kynox Estate!" });
    return;
  }
  try {
    await member.roles.add(rolesToAdd, "Completed Kynox Estate server verification");
    await interaction.editReply({ content: "Verification complete. Welcome to Kynox Estate!" });
  } catch (error) {
    console.error("Could not assign verification roles:", error);
    await interaction.editReply({ content: "I couldn't assign your member roles. Please contact staff to check the bot's Manage Roles permission and role order." });
  }
}

const applicationQuestions = {
  staff: [
    { id: "character", question: "What is your character's name, and which real-estate position are you applying for?" },
    { id: "experience", question: "Describe your character's property, sales, leasing, or customer-service experience." },
    { id: "local_area", question: "Which Broward County communities and property types does your character know best?" },
    { id: "client_service", question: "How would your character learn what a buyer or renter needs before recommending a property?" },
    { id: "listing", question: "What details should a professional property listing include, and why?" },
    { id: "negotiation", question: "A buyer and seller disagree on an offer. How would your character handle the discussion?" },
    { id: "ethics", question: "What would your character do if a client asks them to hide a known property issue?" },
    { id: "availability", question: "When is your character available, and how consistently can they work with clients?" },
  ],
  community: [
    { id: "character", question: "What is your character's full name and occupation? Use fictional roleplay details." },
    { id: "move_reason", question: "Why is your character moving, and what are they hoping to find in Broward County?" },
    { id: "transaction", question: "Is your character looking to rent, lease, or buy? Describe the intended arrangement." },
    { id: "property_type", question: "What property type, size, and key features would suit your character?" },
    { id: "location", question: "Which Broward County area or neighborhood interests your character, and why?" },
    { id: "household", question: "Who is in your character's fictional household, and what are their housing needs?" },
    { id: "budget", question: "What is your character's fictional budget or price range? This is roleplay only." },
    { id: "timeline", question: "When does your character hope to move, and is that timeline flexible?" },
    { id: "must_haves", question: "What are three must-have features, and what would be a deal-breaker?" },
    { id: "property_use", question: "How will your character use the property, and what would daily life there look like?" },
    { id: "viewing", question: "What days or times could your character attend a property viewing?" },
    { id: "additional", question: "What else should the Kynox Estate team know to help your character find a home?" },
  ],
} as const;

async function sendApplicationQuestion(user: User, session: ApplicationSession): Promise<void> {
  const question = applicationQuestions[session.kind][session.questionIndex];
  await user.send(
    `**${applicationKindLabel(session.kind)} Application | Question ${session.questionIndex + 1} of ${applicationQuestions[session.kind].length}**\n\n${question.question}\n\nReply in this DM with your answer (up to 1,000 characters). Your reply is private from other members.`,
  );
}

async function submitApplication(guildId: string, user: User, kind: ApplicationKind, answers: string[]): Promise<boolean> {
  if (!config.applicationReviewChannelId) {
    return false;
  }
  const reviewChannel = await client.channels.fetch(config.applicationReviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased() || !("send" in reviewChannel)) return false;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const questions = applicationQuestions[kind];
  const embeds = [0, 1].map((page) => new EmbedBuilder()
    .setColor(colors.gold)
    .setTitle(`${applicationKindLabel(kind)} Application | ${user.tag}${page ? " (Continued)" : ""}`)
    .setDescription(page ? `Application ID: \`${id}\` | Applicant: <@${user.id}>` : `Applicant: <@${user.id}>\nApplication ID: \`${id}\``)
    .addFields(...questions.slice(page * 6, (page + 1) * 6).map(({ question }, offset) => ({
      name: `Question ${page * 6 + offset + 1}`,
      value: `${question}\n\n${answers[page * 6 + offset].slice(0, 750)}`,
    })))
    .setFooter({ text: `Submitted ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET` }));
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`application:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:reject:${id}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
  );
  await reviewChannel.send({ embeds, components: [controls], allowedMentions: { parse: [] } });
  store.addApplication({ id, guildId, userId: user.id, kind, answers, status: "pending", createdAt: new Date().toISOString() });
  return true;
}

async function handleApplicationAnswer(message: Message): Promise<void> {
  if (message.author.bot || message.channel.type !== ChannelType.DM) return;
  const session = applicationSessions.get(message.author.id);
  if (!session) return;
  if (Date.now() - session.startedAt > 60 * 60 * 1000) {
    applicationSessions.delete(message.author.id);
    await message.author.send("Your application session expired. Please start again from the server application panel.").catch(() => null);
    return;
  }
  const answer = message.content.trim();
  if (!answer || answer.length > 1000) {
    await message.reply("Please send a text answer between 1 and 1,000 characters.");
    return;
  }
  if (session.busy) return;
  session.busy = true;
  session.answers.push(answer);
  session.questionIndex += 1;
  if (session.questionIndex < applicationQuestions[session.kind].length) {
    try {
      await sendApplicationQuestion(message.author, session);
    } catch (error) {
      applicationSessions.delete(message.author.id);
      console.error("Could not send next application question:", error);
      await message.author.send("I couldn’t continue the application in DMs. Please check your DM settings and contact staff to resume.").catch(() => null);
      return;
    }
    session.busy = false;
    return;
  }

  applicationSessions.delete(message.author.id);
  await message.author.send("Your completed application is being sent to the Kynox Estate review team.").catch(() => null);
  const submitted = await submitApplication(session.guildId, message.author, session.kind, session.answers);
  if (!submitted) {
    await message.author.send("Your answers were received, but the review channel is unavailable. Please contact Kynox Estate staff.").catch(() => null);
    return;
  }
  await message.author.send("Application submitted privately to the Kynox Estate review team. Thank you.").catch(() => null);
}

async function handleReview(interaction: ButtonInteraction, decision: "approved" | "rejected", id: string): Promise<void> {
  if (!isStaff(interaction)) {
    await interaction.reply({ content: "Only configured staff can review applications.", ephemeral: true });
    return;
  }
  const application = store.getApplication(id);
  if (!application || application.status !== "pending") {
    await interaction.reply({ content: "This application has already been reviewed or could not be found.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  store.updateApplication(id, decision);
  const original = interaction.message.embeds[0];
  const updated = original
    ? EmbedBuilder.from(original).setColor(decision === "approved" ? colors.green : colors.red).addFields({ name: "Decision", value: `${decision === "approved" ? "Approved" : "Rejected"} by ${interaction.user}.` })
    : undefined;
  await interaction.message.edit({ embeds: updated ? [updated] : [], components: [] });
  if (decision === "approved") {
    const announcementChannel = await interaction.client.channels.fetch(config.applicationAcceptanceChannelId).catch(() => null);
    if (announcementChannel?.isTextBased() && "send" in announcementChannel) {
      const announcement = new EmbedBuilder()
        .setColor(colors.green)
        .setTitle("Application Accepted")
        .setDescription(`<@${application.userId}>, your ${applicationKindLabel(application.kind)} application to Kynox Estate has been accepted.`)
        .setFooter({ text: "Kynox Estate | Broward County Roleplay" })
        .setTimestamp();
      await announcementChannel.send({
        content: `<@${application.userId}>`,
        embeds: [announcement],
        allowedMentions: { parse: [], users: [application.userId] },
      }).catch((error: unknown) => console.warn("Could not post application acceptance notice:", error));
    } else {
      console.warn(`Application acceptance channel ${config.applicationAcceptanceChannelId} is unavailable or not a text channel.`);
    }
  }
  const applicant = await interaction.client.users.fetch(application.userId).catch(() => null);
  await applicant?.send(`Your Kynox Estate ${applicationKindLabel(application.kind).toLowerCase()} application has been ${decision}.`).catch(() => null);
  await interaction.editReply({ content: `Application ${decision}.` });
}

async function handleModeration(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "case" || subcommand === "cases") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need moderation permissions to view cases.", ephemeral: true });
      return;
    }
    if (subcommand === "case") {
      const caseId = interaction.options.getInteger("case_id", true);
      const record = store.getCase(interaction.guildId!, caseId);
      if (!record) {
        await interaction.reply({ content: `Case #${caseId} was not found.`, ephemeral: true });
        return;
      }
      const moderator = await client.users.fetch(record.moderatorId).catch(() => null);
      const target = await client.users.fetch(record.userId).catch(() => null);
      await interaction.reply({ embeds: [makeCaseEmbed(record.id, record.action, moderator ?? interaction.user, target ?? interaction.user, record.reason)], ephemeral: true });
      return;
    }
    const user = interaction.options.getUser("user", true);
    const records = store.getCasesForUser(interaction.guildId!, user.id).slice(0, 10);
    if (!records.length) {
      await interaction.reply({ content: `No moderation cases found for ${user.tag}.`, ephemeral: true });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle(`Recent Cases | ${user.tag}`)
      .setDescription(records.map((record) => `**#${record.id} ${record.action}** | <t:${Math.floor(Date.parse(record.createdAt) / 1000)}:R>\n${record.reason}`).join("\n\n").slice(0, 4000));
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  const action = subcommand as keyof typeof permissionByAction;
  if (!await requireActionPermission(interaction, action)) return;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }

  if (action === "purge") {
    const amount = interaction.options.getInteger("amount", true);
    const channel = getTicketChannel(interaction);
    if (!channel || !("bulkDelete" in channel)) {
      await interaction.reply({ content: "Use purge in a standard text channel.", ephemeral: true });
      return;
    }
    const deleted = await channel.bulkDelete(amount, true);
    const caseId = await logCase(interaction, `purge (${deleted.size} messages)`, interaction.user, "Bulk message cleanup");
    await interaction.reply({ content: `Deleted ${deleted.size} messages. Case #${caseId}.`, ephemeral: true });
    return;
  }

  if (action === "lock" || action === "unlock") {
    const channel = getTicketChannel(interaction);
    if (!channel) {
      await interaction.reply({ content: "Use this command in a server text channel.", ephemeral: true });
      return;
    }
    const locked = action === "lock";
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: locked ? false : null });
    const reason = interaction.options.getString("reason") ?? (locked ? "Channel locked by staff" : "Channel unlocked by staff");
    const caseId = await logCase(interaction, action, interaction.user, reason);
    await interaction.reply({ content: `Channel ${locked ? "locked" : "unlocked"}. Case #${caseId}.`, ephemeral: true });
    return;
  }

  if (action === "unban") {
    const userId = interaction.options.getString("user_id", true).trim();
    if (!/^\d{17,20}$/.test(userId)) {
      await interaction.reply({ content: "Enter a valid Discord user ID.", ephemeral: true });
      return;
    }
    const reason = interaction.options.getString("reason", true);
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      await interaction.reply({ content: "That Discord user could not be found.", ephemeral: true });
      return;
    }
    await guild.members.unban(user, reason);
    const caseId = await logCase(interaction, action, user, reason);
    await interaction.reply({ content: `Unbanned ${user.tag}. Case #${caseId}.`, ephemeral: true });
    return;
  }

  const target = interaction.options.getMember("user");
  if (!target || !("user" in target)) {
    await interaction.reply({ content: "That member could not be found in this server.", ephemeral: true });
    return;
  }
  if (target.id === interaction.user.id || target.id === guild.ownerId) {
    await interaction.reply({ content: "You cannot use this action on yourself or the server owner.", ephemeral: true });
    return;
  }
  const reason = interaction.options.getString("reason", true);
  if (action === "warn") {
    await target.send(`You have received a warning in **${guild.name}**.\nReason: ${reason}`).catch(() => null);
  } else if (action === "timeout") {
    const minutes = interaction.options.getInteger("minutes", true);
    await target.timeout(minutes * 60_000, reason);
  } else if (action === "kick") {
    await target.kick(reason);
  } else if (action === "ban") {
    await target.ban({ reason });
  }
  const caseId = await logCase(interaction, action, target.user, reason);
  await interaction.reply({ content: `${action[0].toUpperCase()}${action.slice(1)} recorded for ${target.user.tag}. Case #${caseId}.`, ephemeral: true });
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "property-map") {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      await interaction.reply({ content: "Use /property-map in a server text channel.", ephemeral: true });
      return;
    }
    const imagePath = fileURLToPath(new URL("../assets/property-map.png", import.meta.url));
    if (!existsSync(imagePath)) {
      await interaction.reply({ content: "The map image isn’t installed yet. Add the provided map image as `assets/property-map.png`, then try again.", ephemeral: true });
      return;
    }
    const imageName = "kynox-property-map.png";
    const mapEmbed = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle("Kynox Estate | Liberty County Property Map")
      .setDescription("Kynox Estates manages the **left side** of Liberty County. Kapri Estates manages the **right side**, including the **gated community owned by Kapri Estates**. Use the map to identify the housing communities and surrounding road network.")
      .addFields(
        { name: "Kynox Estates", value: "Left side of the county, outlined in blue.", inline: true },
        { name: "Kapri Estates", value: "Right side of the county, outlined in purple.", inline: true },
        { name: "Gated Community", value: "Owned and managed by Kapri Estates.", inline: true },
        { name: "Housing Communities", value: "**Fairview** · **Riverside** · **Maplewood**" },
        { name: "Map Key", value: "Colored outlines identify estate territories; neighborhood labels mark housing areas. Roads, rivers, buildings, and terrain are shown for local orientation." },
      )
      .setImage(`attachment://${imageName}`)
      .setFooter({ text: "Kynox Estate | Broward County Roleplay" })
      .setTimestamp();
    await channel.send({
      embeds: [mapEmbed],
      files: [new AttachmentBuilder(readFileSync(imagePath), { name: imageName })],
    });
    await interaction.reply({ content: "The property map has been posted.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "resources") {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      await interaction.reply({ content: "Use /resources in a server text channel.", ephemeral: true });
      return;
    }
    const documentsUrl = "https://drive.google.com/drive/folders/112BVqydhJCbkGeMuT8wQNRFQ-4Q_5-hN?usp=sharing";
    const embed = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle("Kynox Estate | Legal Documents & Resources")
      .setDescription("Access the official Kynox Estate legal documents and community resources using the secure folder below.")
      .addFields({ name: "Document Library", value: `[Open Kynox Estate Legal Documents](${documentsUrl})` })
      .setFooter({ text: "Kynox Estate | Broward County Roleplay" })
      .setTimestamp();
    const linkButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel("Open Legal Documents").setStyle(ButtonStyle.Link).setURL(documentsUrl),
    );
    await channel.send({ embeds: [embed], components: [linkButton] });
    await interaction.reply({ content: "The legal resources embed has been posted.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "verify") {
    await verifyMember(interaction);
    return;
  }

  if (interaction.commandName === "showing") {
    const property = interaction.options.getString("property", true);
    const preferredTime = interaction.options.getString("preferred_time", true);
    const details = interaction.options.getString("details") ?? "No additional details provided.";
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: "Submit a showing request from the Kynox Estate server.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const channel = await interaction.guild.channels.fetch(config.showingRequestsChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      await interaction.editReply({ content: "The configured showing requests channel is unavailable. Please contact staff." });
      return;
    }
    const request = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle("House Showing Request")
      .setDescription("A new property showing request has been submitted.")
      .addFields(
        { name: "Requested by", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
        { name: "Property", value: property },
        { name: "Preferred date and time", value: preferredTime },
        { name: "Additional details", value: details },
      )
      .setFooter({ text: "Kynox Estate | Broward County Roleplay" })
      .setTimestamp();
    await channel.send({
      content: `<@&${config.showingTeamRoleId}>`,
      embeds: [request],
      allowedMentions: { parse: [], roles: [config.showingTeamRoleId] },
    });
    await interaction.editReply({ content: "Your house showing request has been sent to the Kynox Estate team." });
    return;
  }

  if (interaction.commandName === "greet") {
    const recipient = interaction.options.getUser("user", true);
    const personalNote = interaction.options.getString("message");
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased() || !("send" in channel)) {
      await interaction.reply({ content: "Use /greet in a server text channel.", ephemeral: true });
      return;
    }
    const greeting = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle("A Kynox Estate Welcome")
      .setDescription(`Welcome ${recipient} to **Kynox Estate | Broward County Roleplay**!${personalNote ? `\n\n${personalNote}` : " We are glad to have you with us."}`)
      .setThumbnail(recipient.displayAvatarURL())
      .setFooter({ text: "With regards, The Kynox Estate Team" })
      .setTimestamp();
    await channel.send({ embeds: [greeting], allowedMentions: { users: [recipient.id] } });
    await interaction.reply({ content: `Greeting sent for ${recipient}.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setColor(colors.gold)
      .setTitle("Kynox Estate | Bot Commands")
      .setDescription("Staff permissions follow Discord permissions and the configured staff role.")
      .addFields(
        { name: "Verification", value: "`/verify` assigns your member roles. The welcome-message Verify button also works for all members." },
        { name: "Resources", value: "`/resources` posts the legal documents and resources link." },
        { name: "Property map", value: "`/property-map` posts the Liberty County property map with estate boundaries and housing areas." },
        { name: "Community", value: "`/greet user [message]` posts a signed Kynox Estate greeting." },
        { name: "Showings", value: "`/showing request property preferred_time [details]` sends a house showing request and alerts the showing team." },
        { name: "Moderation", value: "`/mod warn`, `/mod timeout`, `/mod kick`, `/mod ban`, `/mod unban`, `/mod purge`, `/mod lock`, `/mod unlock`" },
        { name: "Case history", value: "`/mod case case_id` and `/mod cases user`" },
        { name: "Support", value: "`/ticket panel` posts the ticket button. Support staff can `/ticket claim`; the opener or support staff can `/ticket close`, which saves a transcript and deletes the channel." },
        { name: "Applications", value: "`/application panel` posts staff and housing applications. Questions and answers are collected privately in DMs; review buttons are restricted to staff." },
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "mod") {
    await handleModeration(interaction);
    return;
  }

  if (interaction.commandName === "ticket") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "panel") {
      if (!isStaff(interaction)) {
        await interaction.reply({ content: "Only configured staff can post the ticket panel.", ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("ticket:create").setLabel("Open a support ticket").setStyle(ButtonStyle.Primary),
      );
      const channel = interaction.channel;
      if (!channel || channel.isDMBased() || !("send" in channel)) {
        await interaction.reply({ content: "Use this command in a server text channel.", ephemeral: true });
        return;
      }
      await channel.send({ embeds: [new EmbedBuilder().setColor(colors.ink).setTitle("Kynox Estate Support").setDescription("Need help from the team? Open a private ticket and tell us what is going on.")], components: [row] });
      await interaction.reply({ content: "Support panel posted.", ephemeral: true });
    } else if (subcommand === "claim") {
      await claimTicket(interaction);
    } else {
      await closeTicket(interaction);
    }
    return;
  }

  if (interaction.commandName === "application") {
    if (!isStaff(interaction)) {
      await interaction.reply({ content: "Only configured staff can post the application panel.", ephemeral: true });
      return;
    }
    const selected = interaction.options.getChannel("channel", false, [ChannelType.GuildText]);
    const current = interaction.channel?.type === ChannelType.GuildText ? interaction.channel : null;
    const target = selected ?? current;
    if (!target) {
      await interaction.reply({ content: "Choose a server text channel for the panel.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await target.send(applicationPanel());
    await interaction.editReply({ content: `Application panel posted in ${target}.` });
  }
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      void logSlashCommand(interaction).catch((error: unknown) => console.warn("Could not log slash-command usage:", error));
      await handleCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      if (interaction.customId === "verification:verify") {
        return await verifyMember(interaction);
      }
      if (interaction.customId === "ticket:create") return await createTicket(interaction);
      if (interaction.customId === "ticket:claim") return await claimTicket(interaction);
      if (interaction.customId === "ticket:close") return await closeTicket(interaction);
      const [namespace, action, value] = interaction.customId.split(":");
      if (namespace === "application" && action === "start" && (value === "staff" || value === "community")) {
        if (!interaction.guildId) {
          await interaction.reply({ content: "Start an application from the Kynox Estate server panel.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const kind: ApplicationKind = value;
        applicationSessions.set(interaction.user.id, {
          guildId: interaction.guildId,
          kind,
          answers: [],
          questionIndex: 0,
          startedAt: Date.now(),
          busy: false,
        });
        try {
          await sendApplicationQuestion(interaction.user, applicationSessions.get(interaction.user.id)!);
          await interaction.editReply({ content: "I’ve sent your application questions by direct message. Check your DMs." });
        } catch {
          applicationSessions.delete(interaction.user.id);
          await interaction.editReply({ content: "I couldn’t DM you. Enable direct messages from server members, then start again." });
        }
        return;
      }
      if (namespace === "application" && (action === "approve" || action === "reject") && value) {
        return await handleReview(interaction, action === "approve" ? "approved" : "rejected", value);
      }
    }
  } catch (error) {
    console.error("Interaction failed:", error);
    const message = "That action could not be completed. Check the bot permissions and channel configuration, then try again.";
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
      else await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Kynox Estate Bot is online as ${readyClient.user.tag}.`);
  let activityIndex = 0;
  const updatePresence = () => {
    const activity = presenceActivities[activityIndex];
    readyClient.user.setPresence({ status: "online", activities: [activity] });
    activityIndex = (activityIndex + 1) % presenceActivities.length;
  };
  updatePresence();
  setInterval(updatePresence, 15_000);
});
client.on(Events.GuildMemberAdd, (member) => {
  void welcomeNewMember(member).catch((error: unknown) => console.error("Could not send member welcome:", error));
});
client.on(Events.MessageCreate, (message) => {
  void handleApplicationAnswer(message).catch((error: unknown) => console.error("Could not process application DM:", error));
});
client.on(Events.InteractionCreate, handleInteraction);
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function shutdown(): Promise<void> {
  client.destroy();
  await releaseBotLock().catch((error: unknown) => console.error("Could not release bot process lock:", error));
  process.exit(0);
}

try {
  await client.login(config.token);
} catch (error) {
  await releaseBotLock();
  throw error;
}