"use strict";

// npm packages
require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel] });
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.FRYDERYKGPT_OPENAI_TOKEN });
const openaiThreads = openai.beta.threads; // For ease of change if .beta gets dropped in the future
const { createAudioPlayer, createAudioResource, joinVoiceChannel, NoSubscriberBehavior, VoiceConnectionStatus, AudioPlayerStatus, generateDependencyReport } = require("@discordjs/voice");
// my modules
const getFirstVideo = require("./misc/getFirstVideo");

// global variables
let msgMember;
let connection;
let player;
let voiceChannel;

bot.once("ready", () => {
    // dependency report to verify all needed packages are installed
    console.log("It's-a Me, Fryderyk!\n\n" + generateDependencyReport() + "\n");
});

// slash commands setup
bot.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "introduction") {
        return interaction.reply("En tant que votre Chopin virtuel sous la forme d'un bot Discord, je suis une fusion entre le passé romantique et la technologie moderne. Pour converser avec moi ou pour demander mes compositions, il suffit de me taguer dans un canal ou de m'envoyer un message direct (DM). Je suis à votre service pour vous offrir la musique et la prose du 19ème siècle où que vous soyez dans le serveur.");
    }
});

bot.on("messageCreate", async (msg) => {
    // return if message from bot
    if (msg.author.bot) return;

    // answer if bot tagged or DM
    const botTagged = msg.mentions.users.has(bot.user.id);
    if (msg.channel.type === 1 || (msg.guild && botTagged)) {

        msgMember = msg.member;

        // OpenAi Assistant call
        getAssistantResponse(msg.channel.id, msg.channel, msg.content);
    }
});

// event listener to disconnect bot when nobody in voice channel
bot.on("voiceStateUpdate", async (oldState) => {
    if (oldState.channel && oldState.channel.members.size === 1) {
        connection.destroy();
        console.log("Connection destroyed!");
    };
});

// store threads IDs by user
const threadIdList = {};
async function getAssistantResponse(channelId, channel, userQuery) {
    // assistant setup
    const assistant = await openai.beta.assistants.retrieve(process.env.FRYDERYKGPT_OPENAI_ASSISTANT_ID);

    // check if thread already exists
    if (!threadIdList[channelId]) {
        try {
            const thread = await openaiThreads.create();
            threadIdList[channelId] = thread.id;
            console.log(`New thread (thread_id: ${thread.id}) created for channel: ${channelId}).\n`);
        } catch (err) {
            console.error(`Error creating thread: ${err}`);
        }
    };

    try {
        // create a message
        const message = await openaiThreads.messages.create(
            threadIdList[channelId],
            {
                role: "user",
                content: userQuery
            }
        );

        // create a run
        const run = await openaiThreads.runs.create(
            threadIdList[channelId],
            { assistant_id: assistant.id }
        );

        // wait for the run to complete
        async function waitForCompletion(channel) {
            channel.sendTyping();
            let runRetrieved = await openaiThreads.runs.retrieve(threadIdList[channelId], run.id);
            console.log(`Run status: ${runRetrieved.status}`);
            if (runRetrieved.status === "completed") {
                // retrieve the answer in the thread
                const allMessages = await openaiThreads.messages.list(threadIdList[channelId]);
                // send the message
                channel.send(allMessages.data[0].content[0].text.value);
                return;
            }
            // if status is requires_action --> call function
            if (runRetrieved.status === "requires_action") {
                const toolsToCall = await runRetrieved.required_action.submit_tool_outputs.tool_calls;

                let toolOutputsArray = [];
                for (let eachTool of toolsToCall) {
                    const tool_call_id = eachTool.id;
                    const functionName = eachTool.function.name;
                    const functionArgsJSON = eachTool.function.arguments;

                    // Execute function depending on Assistant API decision
                    let output
                    if (functionName === "playYouTubeAudio") {
                        const functionArgs = JSON.parse(functionArgsJSON).searchQuery;
                        console.log("\n YouTube search query or URL: " + functionArgs);
                        output = await playYouTubeAudio(functionArgs);
                    } else if (functionName === "pauseAudio") {
                        output = await pauseAudio();
                    } else if (functionName === "unpauseAudio") {
                        output = await unpauseAudio();
                    } else if (functionName === "stopAudio") {
                        output = await stopAudio();
                    }
                    toolOutputsArray.push({ "tool_call_id": tool_call_id, "output": output });
                }

                // submit function output
                const submit = await openaiThreads.runs.submitToolOutputs(
                    threadIdList[channelId],
                    run.id,
                    { tool_outputs: toolOutputsArray }
                );
            }
            // else wait for either requires_action or completed status
            setTimeout(() => waitForCompletion(channel), 1500);
        }
        await waitForCompletion(channel);
    } catch (err) {
        console.error(`Error: ${err}`);
    }
}

// play audio
async function playYouTubeAudio(searchQueryOrURL) {
    voiceChannel = msgMember.voice.channel;

    // join message member in voice channel
    if (!voiceChannel) return;

    // connection to appropriate voice channel
    connection = await joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log("\n Connection has entered the Ready State - ready to play audio!");
    });

    // play audio if connection to voice channel successful
    if (!connection) {
        console.log("\n Not in a voice channel\n");
        return "User is not in a voice channel. Their request cannot be fulfilled";
    }

    let videoTitle;
    let stream;
    let type;
    let resource;
    try {
        [stream, videoTitle, type] = await getFirstVideo(searchQueryOrURL);
    } catch (err) {
        console.error(`Error while creating audio stream: ${err}`);
    }

    console.log('Stream:', stream);
    console.log('Type:', type);
    // create audio resource
    try {
        resource = await createAudioResource(stream, {
            inputType: type
        });
    } catch (err) {
        console.error(`Error while creating audio resource: ${err}`);
    }

    // create audio player
    player = await createAudioPlayer({
        behaviors: {
            noSubscriber: NoSubscriberBehavior.Stop,
            maxMissedFrames: 10
        }
    });

    // play audio
    player.play(resource);

    // listen to the player
    connection.subscribe(player);

    player.on("error", (err) => {
        console.error(`Audio player error: ${err}`);
    })

    console.log(`\n Playing ${videoTitle} in channel "${voiceChannel.name}"\n`);
    return `Playing ${videoTitle} in channel "${voiceChannel.name}", as requested`;
}

// pause audio
async function pauseAudio() {
    if (AudioPlayerStatus.Playing) {
        try {
            player.pause();
            console.log("\n Audio paused!\n");
            return "Audio paused!";
        }
        catch (err) {
            console.error(`Error while trying to pause audio: ${err}`);
        }
    } else {
        console.log("\n Could not pause audio...\n");
        return "Could not pause the audio as it is not currently playing";
    }
}

// unpause audio
async function unpauseAudio() {
    if (AudioPlayerStatus.Paused) {
        try {
            player.unpause();
            console.log("\n Audio unpaused!\n");
            return "Audio unpaused!";
        }
        catch (err) {
            console.error(`Error while trying to unpause audio: ${err}`);
        }
    } else {
        console.log("\n Could not unpause audio...\n");
        return "Could not unpause the audio as it is not currently paused";
    }
}

// stop audio
async function stopAudio() {
    if (AudioPlayerStatus.Playing) {
        try {
            player.stop();
            console.log("\n Audio stopped!\n");
            return "Audio stopped!";
        }
        catch (err) {
            console.error(`Error while trying to stop audio: ${err}`);
        }
    } else {
        console.log("\n Could not stop audio...\n");
        return "Could not stop the audio as it is not currently playing";
    }
}

bot.login(process.env.FRYDERYKGPT_DISCORD_TOKEN);
