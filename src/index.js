"use strict";

// npm modules
require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates], partials: [Partials.Channel] });
const OpenAI = require("openai");
const openai = new OpenAI({
    apiKey: process.env.FRYDERYKGPT_OPENAI_TOKEN
});
const { createAudioPlayer, createAudioResource, joinVoiceChannel, NoSubscriberBehavior, VoiceConnectionStatus, AudioPlayerStatus, generateDependencyReport, demuxProbe } = require("@discordjs/voice");
const ytdl = require("ytdl-core");
const yts = require("yt-search");

// global variables
let msgMember;
let connection;
let player;
let voiceChannel;

bot.once("ready", () => {
    // dependency report to verify all needed packages are installed
    console.log("Fryderyk logged in!\n\n" + generateDependencyReport() + "\n");
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

// setup event listener to disconnect bot when nobody in voice channel
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
            const thread = await openai.beta.threads.create();
            threadIdList[channelId] = thread.id;
            console.log(`New thread (thread_id: ${thread.id}) created for channel: ${channelId}).\n`);
        } catch (err) {
            console.error(`Error creating thread: ${err}`);
        }
    };

    try {
        // create a message
        const message = await openai.beta.threads.messages.create(
            threadIdList[channelId],
            {
                role: "user",
                content: userQuery
            }
        );

        // create a run
        const run = await openai.beta.threads.runs.create(
            threadIdList[channelId],
            { assistant_id: assistant.id }
        );

        // wait for the run to complete
        async function waitForCompletion(channel) {
            channel.sendTyping();
            let runRetrieved = await openai.beta.threads.runs.retrieve(threadIdList[channelId], run.id);
            console.log(`Run status: ${runRetrieved.status}`);
            if (runRetrieved.status === "completed") {
                // retrieve the answer in the thread
                const allMessages = await openai.beta.threads.messages.list(threadIdList[channelId]);
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
                const submit = await openai.beta.threads.runs.submitToolOutputs(
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
    let videoTitle;
    if (!connection) {
        console.log("\n Not in a voice channel\n");
        return "User is not in a voice channel. Their request cannot be fulfilled";
    }

    let stream;
    let resource;
    // if URL input
    if (isValidURL(searchQueryOrURL)) {
        // get video name to give Assistant API
        let videoId = searchQueryOrURL.slice(searchQueryOrURL.indexOf("=") + 1);
        let video = await yts({ videoId: videoId })
        videoTitle = video.title;

        // create audio stream
        stream = await ytdl(searchQueryOrURL, { filter: "audioonly" });
        stream.on("error", (err) => {
            console.error(`Error: ${err}`);
        });
        console.log(`Valid URL: ${searchQueryOrURL}`);
        // if search query input
    } else {
        try {
            [stream, videoTitle] = await getFirstVideo(searchQueryOrURL);
        } catch (err) {
            console.error(`Error while creating audio stream: ${err}`);
        }
    }

    // probe audio stream to get type to improve performance
    const probe = await demuxProbe(stream);

    // create audio resource
    try {
        resource = await createAudioResource(stream, {
            inputType: probe.type
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

// get the first video from a search query
async function getFirstVideo(searchQuery) {
    try {
        const { videos } = await yts(searchQuery);

        if (!videos || videos.length <= 0) {
            console.log("No search results found.");
            return;
        }

        const videoId = videos[0].videoId;
        const videoTitle = videos[0].title;
        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, { filter: "audioonly" });

        console.log(`\n First video found: https://www.youtube.com/watch?v=${videoId}`);
        // Check if stream exists before returning
        if (stream) {
            return [stream, videoTitle];
        } else {
            console.log("Invalid stream.");
        }
    } catch (err) {
        console.error(`Error getting audio stream: ${err}`);
    }
}

// verify if valid URL
function isValidURL(url) {
    try {
        return Boolean(new URL(url));
    } catch (err) {
        return false;
    }
}

bot.login(process.env.FRYDERYKGPT_DISCORD_TOKEN);
