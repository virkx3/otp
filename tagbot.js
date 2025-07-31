require('dotenv').config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

// === PROXY SETTINGS ===
const proxy = {
  type: "http",
  ip: "isp.decodo.com",
  port: "10001",
  username: "spg1c4utf1",
  password: "9VUm5exYtkh~iS8h6y"
};

const USERNAME = "tag_iamvirk05";
const PASSWORD = "Virksaabji";
const OTP_URL = "https://raw.githubusercontent.com/virkx3/igbot/refs/heads/main/otp.txt";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const BRANCH = process.env.BRANCH || "main";

const SESSION_FILE = "session.json";
const LAST_POST_FILE = "last_post.json";
const LOCAL_LAST_POST_FILE = "./last_post_local.json";
const POST_COUNT_FILE = "post_count.json";
const LOCAL_POST_COUNT_FILE = "./post_count_local.json";

const TARGET_PROFILE = "iamvirk05";
const TAGGED_URL = `https://www.instagram.com/${TARGET_PROFILE}/tagged/`;
const REELS_URL = `https://www.instagram.com/reels/`;

const SMMWIZ_API_KEY = "1b76d5d4d943819de505bdec81163199";
const SERVICE_ID = "13826";
const ORDER_QUANTITY = 20;
const MAX_LAST_POSTS = 200;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function getRandomInterval() {
  const min = 20000;
  const max = 50000;
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function extractUsernameFromUrl(url) {
  const match = url.match(/instagram\.com\/([^/]+)\/(?:p|reel)\//);
  return match ? match[1] : null;
}

function normalizeInstagramUrl(url) {
  const match = url.match(/instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
  return match ? `https://www.instagram.com/p/${match[1]}/` : url;
}

async function fetchFromGitHub(file) {
  try {
    const res = await axios.get(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/tagbotdata/${file}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    return res.data;
  } catch {
    return null;
  }
}

async function uploadToGitHub(file, content) {
  const url = `https://api.github.com/repos/${REPO}/contents/tagbotdata/${file}`;
  try {
    const getRes = await axios.get(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    const sha = getRes.data.sha;
    await axios.put(
      url,
      {
        message: `Update ${file}`,
        content: Buffer.from(content).toString("base64"),
        sha,
        branch: BRANCH,
      },
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
    );
  } catch (err) {
    if (err.response?.status === 404) {
      await axios.put(
        url,
        {
          message: `Create ${file}`,
          content: Buffer.from(content).toString("base64"),
          branch: BRANCH,
        },
        { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
      );
    }
  }
}

async function loadSession(page) {
  const raw = await fetchFromGitHub(SESSION_FILE);
  if (!raw) return false;
  try {
    const cookies = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    await page.setCookie(...cookies);
    console.log("🔁 Loaded session from GitHub");
    return true;
  } catch {
    return false;
  }
}

async function saveSession(page) {
  const cookies = await page.cookies();
  const valid = cookies.find((c) => c.name === "sessionid");
  if (valid) {
    await uploadToGitHub(SESSION_FILE, JSON.stringify(cookies, null, 2));
    console.log("✅ Session saved to GitHub");
  }
}

async function fetchOTP() {
  try {
    const res = await axios.get(OTP_URL);
    const otp = res.data.trim();
    return otp.length >= 4 && otp.length <= 8 ? otp : null;
  } catch {
    return null;
  }
}

async function login() {
  console.log("🔐 Launching browser with proxy for login...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--proxy-server=${proxy.type}://${proxy.ip}:${proxy.port}`,
      "--no-sandbox"
    ]
  });
  const page = await browser.newPage();
  await page.authenticate({
    username: proxy.username,
    password: proxy.password
  });

  try {
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "networkidle2",
    });

    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.type('input[name="username"]', USERNAME, { delay: 100 });
    await page.type('input[name="password"]', PASSWORD, { delay: 100 });
    await page.click('button[type="submit"]');
    await delay(8000);

    const otpInput = await page.$('input[name="verificationCode"]');
    if (otpInput) {
      console.log("🔐 Waiting 60s before checking OTP...");
      await delay(60000);
      for (let i = 0; i < 60; i++) {
        const otp = await fetchOTP();
        if (otp) {
          console.log("📩 OTP found:", otp);
          await page.type('input[name="verificationCode"]', otp, { delay: 100 });
          await page.click("button[type=button]");
          break;
        }
        await delay(1000);
      }
    }

    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    console.log("✅ Logged in successfully");
    await saveSession(page);
  } catch (e) {
    console.log("❌ Login failed", e.message);
  } finally {
    await browser.close();
  }
}

async function getTaggedPost(page) {
  await page.goto(TAGGED_URL, { waitUntil: "networkidle2" });
  await delay(3000);

  const links = await page.$$eval(
    "a[href*='/p/'], a[href*='/reel/']",
    (as) => as.map((a) => a.href)
  );

  return links.length > 0 ? links[0] : null;
}

async function simulateHumanBehavior(page) {
  console.log("🎥 Watching Reels...");
  await page.goto(REELS_URL, { waitUntil: "networkidle2" });
  await delay(180000);
}

async function sendSmmwizOrder(link) {
  const payload = new URLSearchParams({
    key: SMMWIZ_API_KEY,
    action: "add",
    service: SERVICE_ID,
    link,
    quantity: ORDER_QUANTITY,
  });
  try {
    const res = await axios.post("https://smmwiz.com/api/v2", payload);
    if (res.data.order) {
      console.log("🟢 SMMWiz Order placed: ID", res.data.order);
    } else {
      console.log("❌ SMMWiz Error:", res.data);
    }
  } catch (err) {
    console.log("❌ Order Failed:", err.message);
  }
}

async function getPostCountData() {
  let local = { lastReset: null, counts: {} };
  let remote = { lastReset: null, counts: {} };
  const today = dayjs().format("YYYY-MM-DD");

  if (fs.existsSync(LOCAL_POST_COUNT_FILE)) {
    try { local = JSON.parse(fs.readFileSync(LOCAL_POST_COUNT_FILE, "utf-8")); } catch {}
  }

  const raw = await fetchFromGitHub(POST_COUNT_FILE);
  if (raw) {
    try { remote = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  }

  const data = {
    lastReset: remote.lastReset || local.lastReset || today,
    counts: { ...remote.counts, ...local.counts }
  };

  if (data.lastReset !== today) {
    data.lastReset = today;
    data.counts = {};
    fs.writeFileSync(LOCAL_POST_COUNT_FILE, JSON.stringify(data, null, 2));
    await uploadToGitHub(POST_COUNT_FILE, JSON.stringify(data, null, 2));
    console.log("🔁 Daily post limit reset");
  }

  return data;
}

async function updatePostCount(username) {
  const data = await getPostCountData();
  data.counts[username] = (data.counts[username] || 0) + 1;
  fs.writeFileSync(LOCAL_POST_COUNT_FILE, JSON.stringify(data, null, 2));
  await uploadToGitHub(POST_COUNT_FILE, JSON.stringify(data, null, 2));
}

async function canOrderForUser(username) {
  const data = await getPostCountData();
  return (data.counts[username] || 0) < 2;
}

(async () => {
  while (true) {
    const now = dayjs().tz("Asia/Kolkata");
    const hour = now.hour();
    if (hour >= 22 || hour < 8) {
      console.log("🌙 Sleeping hours (10PM–8AM IST), waiting 10 minutes...");
      await delay(10 * 60 * 1000);
      continue;
    }

    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    const hasSession = await loadSession(page);
    await page.goto("https://www.instagram.com", { waitUntil: "networkidle2" });
    await delay(2000);

    const loggedIn = await page.evaluate(() => document.cookie.includes("ds_user_id"));
    if (!loggedIn) await login();
    else console.log("✅ Already logged in");

    await simulateHumanBehavior(page);

    let lastPosts = [];
    let githubPosts = [];
    if (fs.existsSync(LOCAL_LAST_POST_FILE)) {
      try { lastPosts = JSON.parse(fs.readFileSync(LOCAL_LAST_POST_FILE, "utf-8")); } catch {}
    }
    const raw = await fetchFromGitHub(LAST_POST_FILE);
    if (raw) {
      try { githubPosts = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
    }
    lastPosts = Array.from(new Set([...lastPosts, ...githubPosts]));

    const post = await getTaggedPost(page);
    if (post) {
      const cleanPost = normalizeInstagramUrl(post.split("?")[0]);
      console.log("✅ Cleaned post:", cleanPost);

      const username = extractUsernameFromUrl(cleanPost);

      if (!username) {
        console.log("❌ Failed to extract username from URL. Skipping...");
      } else if (lastPosts.includes(cleanPost)) {
        console.log("⚠️ Already processed post. Skipping...");
      } else if (!(await canOrderForUser(username))) {
        console.log(`⛔ Limit reached for @${username}, skipping order.`);
      } else {
        console.log("📸 Tagged post:", cleanPost);
        await sendSmmwizOrder(cleanPost);
        await updatePostCount(username);

        lastPosts.unshift(cleanPost);
        if (lastPosts.length > MAX_LAST_POSTS) lastPosts.pop();

        fs.writeFileSync(LOCAL_LAST_POST_FILE, JSON.stringify(lastPosts, null, 2));
        await uploadToGitHub(LAST_POST_FILE, JSON.stringify(lastPosts, null, 2));
        console.log("✅ Post saved locally and to GitHub");
      }
    } else {
      console.log("❌ No tagged post found");
    }

    await browser.close();
    const wait = getRandomInterval();
    console.log(`⏳ Waiting ${Math.floor(wait / 1000)}s until next check...`);
    await delay(wait);
  }
})();
