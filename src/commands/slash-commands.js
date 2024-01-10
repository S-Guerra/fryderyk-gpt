"use strict";

// script to run once to add commands to the Discord server

require("dotenv").config();
const { REST, Routes } = require("discord.js");

const commands = [
    {
        name: "introduction",
        description: "Fryderyk introduces himself"
    }
];

const rest = new REST({ version: "10" }).setToken(process.env.FRYDERYKGPT_DISCORD_TOKEN);

(async () => {
    try {
        console.log("Registering slash commands...");

        await rest.put(
            Routes.applicationGuildCommands(process.env.FRYDERYKGPT_CLIENT_ID, process.env.OUR_GUILD_ID),
            { body: commands }
        );

        console.log("Slash were commands registered successfully!");
    } catch (err) {
        console.error(`Error: ${err}`);
    }
})();
