require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');


const app = express();
app.use(cors());
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

// run locally code
    // const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    // console.log(credentialsPath);
// admin.initializeApp({
//     credential: admin.credential.cert(require(path.resolve(credentialsPath))),
// });
// credential: admin.credential.applicationDefault()
// credential: admin.credential.cert(googleCredentials)

// vercel backend setup code for google credentials 
const googleCredentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!googleCredentialsBase64) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS not set!');
    process.exit(1);
  }

  const googleCredentials = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(googleCredentialsBase64), c => c.charCodeAt(0)))
  );
  admin.initializeApp({
    credential: admin.credential.cert(googleCredentials),
  });

mongoose.connect(process.env.MONGO_URI, {
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('Failed to connect to MongoDB:', err);
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    pushToken: { type: String, required: true }
});

const TransactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    status: { type: String, default: 'pending' }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

const wss = new WebSocket.Server({ noServer: true });
const websocketClients = {}; 

app.post('/enroll', async (req, res) => {
    const { email, pushToken } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email missing' });
    }

    if(!pushToken){
        return res.status(400).json({error:"Pushtoken missing in request"})
    }

    try {
        const user = new User({ email, pushToken });
        await user.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Error enrolling user:', err);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

app.post('/login', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('Sending to token:', user.pushToken);
        const transactionId = Math.random().toString(36).substring(2);
        const transaction = new Transaction({ transactionId, email });
        await transaction.save();

        const message = {
            notification: {
                title: 'Login Request',
                body: `A login request was made for your account. Transaction ID: ${transactionId}`
            },
            data: {
                transactionId: transactionId
            },
            token: user.pushToken
        };

        // await admin.messaging().send(message);
    admin.messaging().send(message)
    .then((response) => {
        console.log('Message sent successfully:', response);
        })
    .catch((error) => {
        console.error('Error sending message:', error);
        });
        // try {
        //     await admin.messaging().send(message);
        // } catch (error) {
        //     console.log("Error with sending notification");
        // }
        res.status(200).json({ transactionId });
    } catch (err) {
        console.error('Error initiating login:', err);
        res.status(500).json({ error: 'Failed to initiate login' });
    }
});

app.post('/verify', async (req, res) => {
    const { transactionId, status } = req.body;

    if (!transactionId || !status) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const transaction = await Transaction.findOne({ transactionId });

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        transaction.status = status;
        await transaction.save();

        if (websocketClients[transactionId]) {
            websocketClients[transactionId].send(JSON.stringify({ status }));
            delete websocketClients[transactionId];
        }

        res.status(200).json({ message: 'Verification status updated' });
    } catch (err) {
        console.error('Error verifying transaction:', err);
        res.status(500).json({ error: 'Failed to verify transaction' });
    }
});
app.get('/', (req, res) => {
    res.send('Hello from our server!'); 
});

app.server = app.listen(PORT, () => {
    console.log('Server running on port 3000');
});

app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws, req) => {
    ws.on('message', message => {
        const { action, transactionId } = JSON.parse(message);

        if (action === 'subscribe' && transactionId) {
            websocketClients[transactionId] = ws;
        }
    });

    ws.on('close', () => {
        for (const [transactionId, client] of Object.entries(websocketClients)) {
            if (client === ws) {
                delete websocketClients[transactionId];
                break;
            }
        }
    });
});
// module.exports = app;
