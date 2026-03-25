// server.js (or app.js)
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
require('dotenv').config();
const auth = require("./routers/auth-route");
const adminRoute = require('./routers/admin')
const uploadRoute = require('./routers/upload');

const app = express();
const PORT = process.env.PORT || 5000;



const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI not set in .env');
  process.exit(1);
}

mongoose.connect(uri)
  .then(() => console.log('mongoDB connected'))
  .catch(err => {
    console.error('mongo connect error', err);
    // keep process alive for debugging — optionally exit in prod
  });

mongoose.connection.on('connected', () => console.log('Mongoose connected'));
mongoose.connection.on('error', (err) => console.error('Mongoose connection error:', err));
mongoose.connection.on('disconnected', () => console.log('Mongoose disconnected'));


app.use(express.json());
app.use(cookieParser());

// CORS: allow frontend origins and credentials
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));

app.use('/api/auth', auth);
app.use('/api/admin', adminRoute)
app.use('/api', uploadRoute)

// example protected admin route
app.get('/api/admin/data', require('./middleware/auth').authMiddleware, require('./middleware/auth').adminOnly, (req, res) => {
  res.json({ secret: 'admin only data' });
});

app.listen(PORT, () => console.log('server running on', PORT));
