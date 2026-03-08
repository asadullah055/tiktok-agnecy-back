const mongoose = require("mongoose");

let connectionPromise = null;
let hasLoggedConnection = false;

const connectDb = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    await connectionPromise;
    return mongoose.connection;
  }

  const mongoUri = String(process.env.MONGO_URI || "").trim();
  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  connectionPromise = mongoose
    .connect(mongoUri, {
      serverSelectionTimeoutMS: 8000
    })
    .then((connection) => {
      if (!hasLoggedConnection) {
        hasLoggedConnection = true;
        console.log(`MongoDB connected: ${connection.connection.host}`);
      }
      return connection;
    })
    .catch((error) => {
      connectionPromise = null;
      throw error;
    });

  await connectionPromise;
  return mongoose.connection;
};

module.exports = connectDb;
