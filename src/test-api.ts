/**
 * LearnHouse API Client Tests
 * 
 * Run with: npm test
 */

import { LearnHouseClient } from "./client.js";

const BASE_URL = process.env.LEARNHOUSE_URL || "http://localhost:3000";
const ORG_ID = parseInt(process.env.LEARNHOUSE_ORG_ID || "1");
const EMAIL = process.env.LEARNHOUSE_EMAIL || "admin@ai-automate.me";
const PASSWORD = process.env.LEARNHOUSE_PASSWORD || "";

async function runTests() {
  console.log("🧪 LearnHouse API Client Tests\n");
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Org ID: ${ORG_ID}`);
  console.log(`   Email: ${EMAIL}\n`);

  const client = new LearnHouseClient({
    baseUrl: BASE_URL,
    orgId: ORG_ID,
  });

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ❌ ${name}`);
      console.log(`     Error: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  // ===== Authentication Tests =====
  console.log("\n📋 Authentication Tests");
  
  await test("Health check (no auth)", async () => {
    const result = await client.healthCheck();
    if (!result.status) throw new Error("No status in response");
  });

  if (!PASSWORD) {
    console.log("\n⚠️  Set LEARNHOUSE_PASSWORD to run authenticated tests\n");
    return;
  }

  await test("Login with credentials", async () => {
    const result = await client.login(EMAIL, PASSWORD);
    if (!result.tokens.access_token) throw new Error("No access token");
    if (!result.user.email) throw new Error("No user email");
  });

  await test("Get current user", async () => {
    const user = await client.getCurrentUser();
    if (!user.email) throw new Error("No email in user");
    console.log(`     User: ${user.username} (${user.email})`);
  });

  // ===== Organization Tests =====
  console.log("\n📋 Organization Tests");

  await test("List organizations", async () => {
    const orgs = await client.listOrganizations();
    if (!Array.isArray(orgs)) throw new Error("Expected array");
    console.log(`     Found ${orgs.length} organization(s)`);
  });

  await test("Get organization by ID", async () => {
    const org = await client.getOrganization(ORG_ID);
    if (!org.name) throw new Error("No org name");
    console.log(`     Org: ${org.name} (${org.slug})`);
  });

  // ===== Course Tests =====
  console.log("\n📋 Course Tests");

  let testCourse: Awaited<ReturnType<typeof client.getCourse>> | null = null;

  await test("List courses", async () => {
    const courses = await client.listCourses(1, 10);
    if (!Array.isArray(courses)) throw new Error("Expected array");
    console.log(`     Found ${courses.length} course(s)`);
    if (courses.length > 0) {
      testCourse = courses[0];
    }
  });

  if (testCourse) {
    await test("Get course by UUID", async () => {
      const course = await client.getCourse(testCourse!.course_uuid);
      if (course.id !== testCourse!.id) throw new Error("Course ID mismatch");
    });

    await test("Get course metadata", async () => {
      const meta = await client.getCourseMeta(testCourse!.course_uuid);
      if (!meta.chapters) throw new Error("No chapters in metadata");
      console.log(`     Course "${meta.name}" has ${meta.chapters.length} chapters`);
    });
  }

  // ===== Chapter Tests =====
  console.log("\n📋 Chapter Tests");

  let testChapter: Awaited<ReturnType<typeof client.getChapter>> | null = null;

  if (testCourse) {
    await test("List chapters for course", async () => {
      const chapters = await client.listChapters(testCourse!.id, 1, 10);
      if (!Array.isArray(chapters)) throw new Error("Expected array");
      console.log(`     Found ${chapters.length} chapter(s)`);
      if (chapters.length > 0) {
        testChapter = chapters[0];
      }
    });

    if (testChapter) {
      await test("Get chapter by ID", async () => {
        const chapter = await client.getChapter(testChapter!.id);
        if (chapter.id !== testChapter!.id) throw new Error("Chapter ID mismatch");
        console.log(`     Chapter: ${chapter.name}`);
      });
    }
  }

  // ===== Activity Tests =====
  console.log("\n📋 Activity Tests");

  let testActivity: Awaited<ReturnType<typeof client.getActivity>> | null = null;

  if (testChapter) {
    await test("List activities for chapter", async () => {
      const activities = await client.listActivities(testChapter!.id);
      if (!Array.isArray(activities)) throw new Error("Expected array");
      console.log(`     Found ${activities.length} activity(ies)`);
      if (activities.length > 0) {
        testActivity = activities[0];
      }
    });

    if (testActivity) {
      await test("Get activity by UUID", async () => {
        const activity = await client.getActivity(testActivity!.activity_uuid);
        if (activity.id !== testActivity!.id) throw new Error("Activity ID mismatch");
        console.log(`     Activity: ${activity.name}`);
      });
    }
  }

  // ===== Collection Tests =====
  console.log("\n📋 Collection Tests");

  await test("List collections", async () => {
    const collections = await client.listCollections(1, 10);
    if (!Array.isArray(collections)) throw new Error("Expected array");
    console.log(`     Found ${collections.length} collection(s)`);
  });

  // ===== Search Tests =====
  console.log("\n📋 Search Tests");

  await test("Search for courses", async () => {
    const results = await client.search("MCP", "courses");
    console.log(`     Found ${results.courses?.length || 0} course(s) matching "MCP"`);
  });

  // ===== Summary =====
  console.log("\n" + "=".repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(50) + "\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
