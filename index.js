// configuration
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });
const OpenAI = require('openai');
const openai = new OpenAI({
    apiKey: process.env.FRYDERYKGPT_OPENAI_TOKEN
});

bot.on('ready', () => {
    console.log('Fryderyk logged in!');
})

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const botTagged = message.mentions.users.has(bot.user.id);
    if (message.channel.type === 1 || (message.guild && botTagged)) {
        // tests
        console.log(`Channel ID: ${message.channel.id}`);
        console.log(`Author ID: ${message.author.id}`);

        // OpenAi Assistant call
        getAssistantResponse(message.channel.id, message.channel, message.content);
    }
})

// store threads IDs by user
// use database if too many different users
const threadIdList = {};
async function getAssistantResponse(userOrChannelID, channel, userQuery) {
    // assistant setup
    const assistant = await openai.beta.assistants.retrieve(assistant_id = process.env.FRYDERYKGPT_OPENAI_ASSISTANT_ID);

    // check if thread already exists
    if (!threadIdList[userOrChannelID]) {
        try {
            const thread = await openai.beta.threads.create();
            threadIdList[userOrChannelID] = thread.id;
            console.log(`New thread (thread_id: ${thread.id}) created for user or channel (user_id or channel_id: ${userOrChannelID}).`);
        } catch (err) {
            console.error(`Error creating thread: ${err}`);
        }
    };

    try {
        // create a message
        const message = await openai.beta.threads.messages.create(
            threadIdList[userOrChannelID],
            {
                role: "user",
                content: userQuery
            }
        );

        // create a run
        const run = await openai.beta.threads.runs.create(
            threadIdList[userOrChannelID],
            { assistant_id: assistant.id }
        );

        // wait for the run to complete
        async function waitForCompletion(channel) {
            channel.sendTyping();
            setTimeout(async () => {
                let runStatus = await openai.beta.threads.runs.retrieve(threadIdList[userOrChannelID], run.id);
                if (runStatus.status !== "completed") {
                    runStatus = await openai.beta.threads.runs.retrieve(threadIdList[userOrChannelID], run.id);
                    console.log(`Run status: ${runStatus.status}`);
                    waitForCompletion(channel);

                } else if (runStatus.status === "completed") {
                    console.log(`Run status: ${runStatus.status}`);
                    // retrieve the answer in the thread
                    const allMessages = await openai.beta.threads.messages.list(threadIdList[userOrChannelID]);
                    // send the message
                    channel.send(allMessages.data[0].content[0].text.value);
                }
            }, 1500);
        }
        await waitForCompletion(channel);

    } catch (err) {
        console.error(`Error: ${err}`);
    }
}

bot.login(process.env.FRYDERYKGPT_DISCORD_TOKEN);
