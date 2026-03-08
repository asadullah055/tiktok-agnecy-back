require("dotenv").config();
const app = require("./app");
const connectDb = require("./config/db");

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDb();
  app.listen(PORT, () => {
    console.log(`CRM backend server running on port ${PORT}`);
  });
};

start();
