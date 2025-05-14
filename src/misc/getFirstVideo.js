"use strict";

const ytdl = require("ytdl-core");
const yts = require("yt-search");
const isValidURL = require("./isValidURL");

// get the first video from a search query
async function getFirstVideo(searchQueryOrURL) {
    try {
        let videoId;
        let videoTitle;

        if (isValidURL(searchQueryOrURL)) {
            videoId = searchQueryOrURL.slice(searchQueryOrURL.indexOf("=") + 1);
            const video = await yts({ videoId: videoId });
            videoTitle = video.title;
            console.log(`Valid URL: ${searchQueryOrURL}`);
        } else {
            const videoList = await yts(searchQueryOrURL);

            if (!videoList || videoList.all.length === 0) {
                throw new Error("No search results found for your query.");
            }

            videoId = videoList.all[0].videoId;
            videoTitle = videoList.all[0].title;
            console.log(`\n First video found: https://www.youtube.com/watch?v=${videoId}`);
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, { filter: "audioonly" });

        if (!stream) {
            throw new Error("Failed to create audio stream.");
        }

        return [stream, videoTitle];

    } catch (err) {
        throw new Error(`getFirstVideo() failed: ${err.message}`);
    }
}

module.exports = getFirstVideo;
