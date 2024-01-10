"use strict";

const ytdl = require("ytdl-core");
const yts = require("yt-search");

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

module.exports = getFirstVideo;
