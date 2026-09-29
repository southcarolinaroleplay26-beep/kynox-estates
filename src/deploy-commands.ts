import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config, validateConfig } from "./config.js";

validateConfig();
const rest = new REST({ version: "10" }).setToken(config.token);
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body: commands });
console.log(`Registered ${commands.length} slash commands ${config.guildId ? "to the test guild" : "globally"}.`);