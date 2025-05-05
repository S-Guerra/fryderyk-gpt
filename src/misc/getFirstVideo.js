"use strict";

const play = require("play-dl");
const yts = require("yt-search");
const isValidURL = require("./isValidURL");

async function getFirstVideo(searchQueryOrURL) {
    try {
        let url;
        let title;

        await play.setToken({
            youtube: {
                cookie: process.env.YOUTUBE_COOKIE
            }
        });

        // If the input is a valid YouTube URL
        if (isValidURL(searchQueryOrURL)) {
            url = searchQueryOrURL;

            // Extract video ID
            const videoId = new URL(url).searchParams.get("v");
            const video = await yts({ videoId });

            title = video?.title || "Unknown Title";

            console.log(`\n Valid URL input: ${url}`);
        } else {
            // Input is a search query
            const { videos } = await yts(searchQueryOrURL);

            if (!videos || videos.length === 0) {
                console.log("No results found.");
                return;
            }

            url = `https://www.youtube.com/watch?v=${videos[0].videoId}`;
            title = videos[0].title;

            console.log(`\n First search result: ${url}`);
        }

        // Get audio stream from play-dl
        const streamData = await play.stream(url, { quality: 2 });

        return [streamData.stream, title, streamData.type];
    } catch (err) {
        console.error(`Error in getFirstVideo: ${err}`);
    }
}

module.exports = getFirstVideo;
