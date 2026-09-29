export const config = {
  token: process.env.DISCORD_TOKEN ?? "",
  clientId: process.env.CLIENT_ID ?? "",
  guildId: process.env.GUILD_ID ?? "",
  staffRoleId: process.env.STAFF_ROLE_ID ?? "",
  supportRoleId: process.env.SUPPORT_ROLE_ID ?? "",
  modLogChannelId: "1554252380776702013",
  welcomeChannelId: "1554251423590522880",
  verifiedRoleIds: ["1554254120972451910", "1554254552809734154"],
  showingTeamRoleId: "1554254362220437594",
  showingRequestsChannelId: "1554252002173919272",
  ticketCategoryId: process.env.TICKET_CATEGORY_ID ?? "",
  ticketLogChannelId: process.env.TICKET_LOG_CHANNEL_ID ?? "",
  applicationReviewChannelId: process.env.APPLICATION_REVIEW_CHANNEL_ID ?? "",
  applicationAcceptanceChannelId: "1554251916110725230",
};

export function validateConfig(): void {
  const missing = [
    ["DISCORD_TOKEN", config.token],
    ["CLIENT_ID", config.clientId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
}