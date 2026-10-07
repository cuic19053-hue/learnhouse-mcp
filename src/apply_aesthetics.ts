import { LearnHouseClient } from "./client.js";
import fs from "node:fs";
import path from "node:path";

const config = {
  baseUrl: process.env.LEARNHOUSE_URL || "http://localhost:3000",
  email: process.env.LEARNHOUSE_EMAIL || "",
  password: process.env.LEARNHOUSE_PASSWORD || "",
  orgId: parseInt(process.env.LEARNHOUSE_ORG_ID || "1", 10),
};

async function main() {
  const client = new LearnHouseClient({
    baseUrl: config.baseUrl,
    orgId: config.orgId,
  });

  console.log("Logging in...");
  await client.login(config.email, config.password);

  // 1. Upload Thumbnail to Mastering MCP
  const courseUuid = "course_d6d76f09-c553-4f82-ab81-82a1c69fdd5f";
  const imagePath = "\\\\192.168.2.108\\Users\\Laptop\\Desktop\\Projects\\Studies\\Winter_2026\\01_SIA 3000 - Projet integrateur\\AgentOne_Project\\_Handover\\Hero\\1_Hero_Backgrounds\\hero_grid_08_circuit_grid.png";
  
  if (fs.existsSync(imagePath)) {
    console.log(`Uploading thumbnail: ${imagePath}`);
    const buffer = fs.readFileSync(imagePath);
    const fileName = path.basename(imagePath);
    const updatedCourse = await client.uploadCourseThumbnail(courseUuid, buffer, fileName);
    console.log(`✅ Thumbnail uploaded! URL: ${updatedCourse.thumbnail_image}`);
  } else {
    console.warn(`⚠️ Image not found: ${imagePath}`);
  }

  // 2. Create Collection
  console.log("Creating collection 'Artemis AI Core Protocols'...");
  const collection = await client.createCollection({
    name: "Artemis AI Core Protocols",
    description: "Foundational protocols and frameworks for the Agentic Internet.",
    courses: [16], // Mastering MCP
    public: true,
  });
  console.log(`✅ Collection created! UUID: ${collection.collection_uuid}`);
}

main().catch(console.error);
