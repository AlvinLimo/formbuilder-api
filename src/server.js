
import "dotenv/config";
import app from "./index.js";

const PORT = process.env.PORT || 4000;

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in your .env file.");
}

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
