require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/* ==========================================================
                    FIREBASE INITIALIZATION
========================================================== */

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("🔥 Firebase Initialized");

/* ==========================================================
                    DATABASE
========================================================== */

mongoose.connect(process.env.MONGO_URI)

.then(() => {

    console.log("✅ MongoDB Connected");

})

.catch(err => {

    console.log("Mongo Error:", err);

});

/* ==========================================================
                    USER SCHEMA
========================================================== */

const userSchema = new mongoose.Schema({

    username:{

        type:String,

        unique:true,

        required:true

    },

    password:{

        type:String,

        required:true

    },

    /* MULTIPLE DEVICES */

    fcmTokens:[

        {

            type:String

        }

    ],

    lastLocation:{

        lat:Number,

        lon:Number

    },

    lastSeen:{

        type:Date,

        default:Date.now

    },

    lastSOS:{

        active:{

            type:Boolean,

            default:false

        },

        acknowledged:{

            type:Boolean,

            default:false

        },

        acknowledgedBy:{

            type:String,

            default:""

        },

        acknowledgedAt:Date

    }

});

/* ==========================================================
                    SOS HISTORY
========================================================== */

const sosSchema = new mongoose.Schema({

    victim:String,

    latitude:Number,

    longitude:Number,

    active:{

        type:Boolean,

        default:true

    },

    acknowledged:{

        type:Boolean,

        default:false

    },

    acknowledgedBy:String,

    createdAt:{

        type:Date,

        default:Date.now

    },

    resolvedAt:Date

});

const User = mongoose.model(
    "User",
    userSchema
);

const SOS = mongoose.model(
    "SOS",
    sosSchema
);

/* ==========================================================
                HELPER FUNCTIONS
========================================================== */

function addToken(user, token){

    if(!token) return;

    if(!user.fcmTokens)
        user.fcmTokens=[];

    if(!user.fcmTokens.includes(token)){

        user.fcmTokens.push(token);

    }

}
function uniqueTokens(tokens){

    return [...new Set(tokens)];

}
/* ==========================================================
                    REGISTER
========================================================== */

app.post("/register", async(req,res)=>{
try{
const{
username,
password,
fcmToken
}=req.body;
if(
!username ||
!password
){
return res.status(400).json({
error:"Missing Fields"
});
}
const exists=
await User.findOne({
username
});
if(exists){
return res.status(400).json({
error:"User Already Exists"
});
}
const hash=
await bcrypt.hash(
password,
10
);
const user=
new User({
username,
password:hash,
fcmTokens:[]
});
addToken(
user,
fcmToken
);
await user.save();
console.log(
"🟢 REGISTER:",
username
);
res.json({
success:true,
message:"Registration Successful"
});
}
catch(err){
console.log(err);
res.status(500).json({
error:"Registration Failed"
});
}
});
/* ==========================================================
                    LOGIN
========================================================== */

app.post("/login", async(req,res)=>{
try{
const{
username,
password,
fcmToken
}=req.body;
const user=
await User.findOne({
username
});
if(!user){
return res.status(400).json({
error:"User Not Found"
});
}
const match=
await bcrypt.compare(
password,
user.password
);
if(!match){
return res.status(400).json({
error:"Wrong Password"
});
}
addToken(
user,
fcmToken
);
user.lastSeen=
new Date();
await user.save();
console.log(
"🔵 LOGIN:",
username
);
res.json({
success:true,
message:"Login Successful"
});
}
catch(err){
console.log(err);
res.status(500).json({
error:"Login Failed"
});
}
});
/* ==========================================================
                    SOS TRIGGER
========================================================== */

app.post("/sos", async (req, res) => {

    try {

        const {
            username,
            lat,
            lon
        } = req.body;

        if (
            !username ||
            lat === undefined ||
            lon === undefined
        ) {

            return res.status(400).json({
                error: "Missing SOS Data"
            });

        }

        const sender =
            await User.findOne({
                username
            });

        if (!sender) {

            return res.status(404).json({
                error: "User Not Found"
            });

        }

        /* ---------------------------------------
            SAVE LATEST LOCATION
        ---------------------------------------- */

        sender.lastLocation = {
            lat,
            lon
        };

        sender.lastSeen = new Date();

        sender.lastSOS = {

            active: true,

            acknowledged: false,

            acknowledgedBy: "",

            acknowledgedAt: null

        };

        await sender.save();

        /* ---------------------------------------
            STORE SOS HISTORY
        ---------------------------------------- */

        const sos = new SOS({

            victim: username,

            latitude: lat,

            longitude: lon,

            active: true,

            acknowledged: false,

            acknowledgedBy: ""

        });

        await sos.save();

        console.log(
            "🚨 SOS RECEIVED:",
            username
        );

        /* ---------------------------------------
            FIND ALL USERS
        ---------------------------------------- */

        const users = await User.find({

            username: {
                $ne: username
            }

        });

        let tokens = [];

        users.forEach(user => {

            if (
                user.fcmTokens &&
                user.fcmTokens.length > 0
            ) {

                tokens.push(
                    ...user.fcmTokens
                );

            }

        });

        tokens = uniqueTokens(tokens);

        if (tokens.length === 0) {

            console.log(
                "⚠ No receivers found."
            );

            return res.json({

                success: true,

                message:
                    "SOS stored. No receivers."

            });

        }

        console.log(
            "📱 Sending to",
            tokens.length,
            "device(s)"
        );

        /* ---------------------------------------
            FIREBASE NOTIFICATION
        ---------------------------------------- */

        const message = {

            notification: {

                title:
                    "🚨 EMERGENCY ALERT",

                body:
                    `${username} needs immediate help.`

            },

            data: {

                type: "SOS",

                username,

                lat: String(lat),

                lon: String(lon),

                timestamp:
                    Date.now().toString()

            },

            android: {

                priority: "high"

            },

            tokens

        };

        const response =
            await admin.messaging()
                .sendEachForMulticast(message);

        console.log(
            "✅ Success:",
            response.successCount
        );

        console.log(
            "❌ Failed:",
            response.failureCount
        );

        /* ---------------------------------------
            REMOVE INVALID TOKENS
        ---------------------------------------- */

        if (
            response.failureCount > 0
        ) {

            const invalidTokens = [];

            response.responses.forEach(

                (result, index) => {

                    if (!result.success) {

                        const code =
                            result.error?.code;

                        if (

                            code ===
                            "messaging/registration-token-not-registered"

                            ||

                            code ===
                            "messaging/invalid-registration-token"

                        ) {

                            invalidTokens.push(
                                tokens[index]
                            );

                        }

                    }

                }

            );

            if (
                invalidTokens.length > 0
            ) {

                console.log(

                    "🧹 Removing",

                    invalidTokens.length,

                    "invalid token(s)"

                );

                await User.updateMany(

                    {},

                    {

                        $pull: {

                            fcmTokens: {

                                $in:
                                    invalidTokens

                            }

                        }

                    }

                );

            }

        }

        res.json({

            success: true,

            receivers:
                response.successCount,

            message:
                "SOS Broadcast Successfully"

        });

    }

    catch (err) {

        console.log(

            "SOS ERROR:",

            err

        );

        res.status(500).json({

            error:
                "Internal Server Error"

        });

    }

});
/* ==========================================================
                    ACKNOWLEDGE SOS
========================================================== */

app.post("/acknowledge", async (req, res) => {

    try {

        const {
            victimUsername,
            guardianUsername
        } = req.body;

        if (!victimUsername || !guardianUsername) {

            return res.status(400).json({
                error: "Missing Fields"
            });

        }

        const victim = await User.findOne({
            username: victimUsername
        });

        if (!victim) {

            return res.status(404).json({
                error: "Victim Not Found"
            });

        }

        if (!victim.lastSOS.active) {

            return res.status(400).json({
                error: "No Active SOS"
            });

        }

        if (victim.lastSOS.acknowledged) {

            return res.json({
                success: false,
                message: `Already acknowledged by ${victim.lastSOS.acknowledgedBy}`
            });

        }

        victim.lastSOS.acknowledged = true;
        victim.lastSOS.acknowledgedBy = guardianUsername;
        victim.lastSOS.acknowledgedAt = new Date();

        await victim.save();

        await SOS.findOneAndUpdate(

            {
                victim: victimUsername,
                active: true
            },

            {
                acknowledged: true,
                acknowledgedBy: guardianUsername
            }

        );

        console.log(
            `🟢 ${guardianUsername} acknowledged ${victimUsername}'s SOS`
        );

        if (

            victim.fcmTokens &&
            victim.fcmTokens.length > 0

        ) {

            await admin.messaging().sendEachForMulticast({

                tokens: victim.fcmTokens,

                notification: {

                    title: "🟢 Help Is On The Way",

                    body: `${guardianUsername} is responding.`

                },

                data: {

                    type: "ACKNOWLEDGED",

                    guardian: guardianUsername

                }

            });

        }

        res.json({

            success: true,

            message: "Acknowledgement Sent"

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            error: "Acknowledgement Failed"

        });

    }

});

/* ==========================================================
                    RESOLVE SOS
========================================================== */

app.post("/resolve", async (req, res) => {

    try {

        const {

            username

        } = req.body;

        const user = await User.findOne({

            username

        });

        if (!user) {

            return res.status(404).json({

                error: "User Not Found"

            });

        }

        user.lastSOS.active = false;

        await user.save();

        await SOS.findOneAndUpdate(

            {

                victim: username,

                active: true

            },

            {

                active: false,

                resolvedAt: new Date()

            }

        );

        console.log(

            "✅ SOS Resolved:",

            username

        );

        res.json({

            success: true

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            error: "Resolve Failed"

        });

    }

});

/* ==========================================================
                UPDATE LIVE LOCATION
========================================================== */

app.post("/updateLocation", async (req, res) => {

    try {

        const { username, lat, lon } = req.body;

        if (
            !username ||
            lat === undefined ||
            lon === undefined
        ) {
            return res.status(400).json({
                error: "Missing location data"
            });
        }

        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        // Update only the latest location
        user.lastLocation = {
            lat,
            lon
        };

        user.lastSeen = new Date();

        await user.save();

        res.json({
            success: true,
            message: "Location updated"
        });

    } catch (err) {

        console.log("Update Location Error:", err);

        res.status(500).json({
            error: "Failed to update location"
        });

    }

});

/* ==========================================================
                    LIVE LOCATION
========================================================== */

app.get("/location", async (req, res) => {
    try {
        const {
            username
        } = req.query;
        const user = await User.findOne({
            username
        });
        if (
            !user ||
            !user.lastLocation
        ) {
            return res.status(404).json({
                error: "Location Not Found"
            });
        }
        res.json({
            lat: user.lastLocation.lat,
            lon: user.lastLocation.lon,
            acknowledged:
                user.lastSOS.acknowledged,
            acknowledgedBy:
                user.lastSOS.acknowledgedBy,
            active:
                user.lastSOS.active
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Location Error"
        });
    }
});
/* ==========================================================
                    SERVER
========================================================== */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log("");
    console.log("======================================");
    console.log("🚀 Women Safety Server Started");
    console.log("🌐 Port:", PORT);
    console.log("🔥 Firebase Connected");
    console.log("🗄 MongoDB Connected");
    console.log("======================================");
});