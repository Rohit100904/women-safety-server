require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

/* ==============================
   🔥 FIREBASE INIT
============================== */

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/* ==============================
   🗄 MONGODB CONNECT
============================== */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("Mongo Error:", err));

/* ==============================
   🧩 SCHEMAS
============================== */

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  fcmToken: String,
  lastLocation: {
    lat: Number,
    lon: Number,
  },
});

const User = mongoose.model("User", userSchema);

/* ==============================
   📝 REGISTER
============================== */

app.post("/register", async (req, res) => {
  try {
    const { username, password, fcmToken } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: "Missing fields" });

    const hashed = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashed,
      fcmToken,
    });

    await user.save();

    console.log("🟢 REGISTER:", username);

    res.json({ message: "Registered successfully" });
  } catch (err) {
    res.status(400).json({ error: "User already exists" });
  }
});

/* ==============================
   🔐 LOGIN
============================== */

app.post("/login", async (req, res) => {
  try {
    const { username, password, fcmToken } = req.body;

    const user = await User.findOne({ username });

    if (!user) return res.status(400).json({ error: "User not found" });

    const match = await bcrypt.compare(password, user.password);

    if (!match) return res.status(400).json({ error: "Wrong password" });

    // Update FCM token
    user.fcmToken = fcmToken;
    await user.save();

    console.log("🔵 LOGIN:", username);

    res.json({ message: "Login successful" });
  } catch (err) {
    res.status(500).json({ error: "Login error" });
  }
});

/* ==============================
   🚨 SOS TRIGGER
============================== */

app.post("/sos", async (req, res) => {
  try {
    const { username, lat, lon } = req.body;

    const sender = await User.findOne({ username });
    if (!sender) return res.status(400).json({ error: "User not found" });

    // Save latest location
    sender.lastLocation = { lat, lon };
    await sender.save();

    console.log("🚨 SOS FROM:", username, lat, lon);

    // Send to ALL other users except sender
    const users = await User.find({ username: { $ne: username } });

    const tokens = users
      .map((u) => u.fcmToken)
      .filter((token) => token && token.length > 0);

    if (tokens.length === 0) {
      console.log("⚠ No tokens to send");
      return res.json({ message: "SOS stored but no receivers" });
    }

    const message = {
      notification: {
        title: "🚨 EMERGENCY ALERT",
        body: `${username} needs help!`,
      },
      data: {
        username,
        lat: String(lat),
        lon: String(lon),
      },
      tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log("📩 Notifications sent:", response.successCount);

    res.json({ message: "SOS sent" });
  } catch (err) {
    console.log("SOS ERROR:", err);
    res.status(500).json({ error: "SOS error" });
  }
});

/* ==============================
   📍 LIVE LOCATION FETCH
============================== */

app.get("/location", async (req, res) => {
  try {
    const { username } = req.query;

    const user = await User.findOne({ username });

    if (!user || !user.lastLocation)
      return res.status(404).json({ error: "Location not found" });

    res.json(user.lastLocation);
  } catch (err) {
    res.status(500).json({ error: "Location error" });
  }
});

/* ==============================
   🚀 START SERVER
============================== */

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
