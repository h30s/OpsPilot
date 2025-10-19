import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID; // Optional: for faster dev registration

if (!token || !clientId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if OpsPilot is operational')
    .toJSON(),
  
  new SlashCommandBuilder()
    .setName('opspilot')
    .setDescription('OpsPilot control panel')
    .toJSON(),
  
  new SlashCommandBuilder()
    .setName('simulate')
    .setDescription('Simulate an alert for testing')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of alert to simulate')
        .setRequired(true)
        .addChoices(
          { name: 'High Memory', value: 'memory' },
          { name: 'High CPU', value: 'cpu' },
          { name: 'Service Down', value: 'service' },
          { name: 'Disk Space', value: 'disk' }
        ))
    .toJSON(),
  
  new SlashCommandBuilder()
    .setName('incidents')
    .setDescription('View recent incidents')
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Filter by status')
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'New', value: 'new' },
          { name: 'Triaged', value: 'triaged' },
          { name: 'In Progress', value: 'in_progress' },
          { name: 'Resolved', value: 'resolved' },
          { name: 'Failed', value: 'failed' }
        ))
    .toJSON(),
  
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View OpsPilot statistics')
    .toJSON(),
  
  new SlashCommandBuilder()
    .setName('runbook')
    .setDescription('Search for runbooks')
    .addStringOption(option =>
      option.setName('keyword')
        .setDescription('Keyword to search for')
        .setRequired(true))
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    if (guildId) {
      // Guild-specific commands (instant update for development)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      console.log(`Successfully registered ${commands.length} guild commands.`);
    } else {
      // Global commands (may take up to an hour to propagate)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      console.log(`Successfully registered ${commands.length} global commands.`);
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();
