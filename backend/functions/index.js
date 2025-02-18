const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler"); // Correct import for scheduling
const axios = require("axios"); // Use Axios instead of node-fetch
const express = require("express");
const cors = require("cors");
require("dotenv").config();

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.SPORTSDATA_API_KEY; // Free Trial API key
const SEASON = "2024"; // Define the season to fetch data for
const BASE_URL = "https://api.sportsdata.io/v3/nfl/stats/json";

/**
 * Fetch data with error handling
 */
async function fetchData(url) {
  try {
    const response = await axios.get(url, { timeout: 5000 }); // 5-second timeout
    return response.data;
  } catch (error) {
    console.error(`Error fetching data from ${url}:`, error.message);
    throw new Error("Failed to fetch data");
  }
}

/**
 * Refresh player game logs in Firestore
 */
async function refreshPlayerGameLog(playerId) {
  try {
    const url = `${BASE_URL}/PlayerGameStatsBySeason/${SEASON}/${playerId}/all?key=${API_KEY}`;
    const data = await fetchData(url);

    if (!data || data.length === 0) {
      console.log(`No game log data found for player ${playerId}`);
      return;
    }

    await db
      .collection("gameLogs")
      .doc(`${playerId}_${SEASON}_${data[0].ShortName}`)
      .set({
        data,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

    console.log(`Updated game log for player ${playerId}`);
  } catch (error) {
    console.error(`Error updating game log for ${playerId}:`, error);
  }
}

/**
 * Cloud Function to get a player's game log
 */
exports.getPlayerGameLog = functions.https.onRequest(async (req, res) => {
  try {
    const playerId = req.query.playerId;
    const season = req.query.season;

    if (!playerId || !season) {
      return res.status(400).json({ error: "Missing playerId or season" });
    }

    const url = `${BASE_URL}/PlayerGameStatsBySeason/${SEASON}/${playerId}/all?key=${API_KEY}`;
    const data = await fetchData(url);

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Scheduled function: Runs every day at 3 AM UTC
 */
exports.updateGameLogs = functions.https.onRequest(async (req, res) => {
  console.log("Updating player game logs...");
  try {
    const playerId = req.query.playerId;
    if (!playerId) {
      return res.status(400).json({ error: "Missing playerId" });
    }

    await refreshPlayerGameLog(playerId);
    console.log("Game log updates completed.");
    return res.status(200).json(`Updated game log for player: ${playerId}`);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Cloud Function to get NFL team profiles by season
 */
exports.getNFLTeamProfilesbySeason = functions.https.onRequest(
  async (req, res) => {
    console.log("Fetching NFL team profiles...");
    console.log("Testing");

    try {
      const season = req.query.season;
      if (!season) {
        return res.status(400).json({ error: "Missing season parameter" });
      }

      const url = `${BASE_URL}/Teams/${season}?key=${API_KEY}`;
      const teams = await fetchData(url); // Fetch team data using Axios

      if (!teams || teams.length === 0) {
        console.log("No team data found.");
        return res.status(200).json({ message: "No team data available" });
      }

      const batch = db.batch();
      teams.forEach((team) => {
        const teamRef = db
          .collection("TeamProfile")
          .doc(`${team.Key}_${team.TeamID}`);
        batch.set(teamRef, team, { merge: true });
      });

      await batch.commit();
      console.log("Teams successfully updated in Firestore.");
      return res
        .status(200)
        .json({ message: "Updated NFL Team Profile Information." });
    } catch (error) {
      console.error("Error fetching or updating teams:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/**
 * Deployable Firebase Function (Express API)
 */
exports.api = functions.https.onRequest(app);
