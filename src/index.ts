/**
 * LearnHouse MCP Server
 * 
 * Model Context Protocol server for LearnHouse LMS.
 * Provides tools for managing courses, chapters, activities, and users.
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { LearnHouseClient } from "./client.js";
import { WebsiteApi } from "./website-api.js";
import { CaptchaLogin } from "./captcha-login.js";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Configuration
// ============================================================

const config = {
  baseUrl: process.env.LEARNHOUSE_URL || process.env.LEARNHOUSE_API_URL || "http://localhost:3000",
  email: process.env.LEARNHOUSE_EMAIL || "",
  password: process.env.LEARNHOUSE_PASSWORD || "",
  accessToken: process.env.LEARNHOUSE_ACCESS_TOKEN || process.env.LEARNHOUSE_API_TOKEN || "",
  orgId: parseInt(process.env.LEARNHOUSE_ORG_ID || "1", 10),
  orgUuid: process.env.LEARNHOUSE_ORG_UUID || undefined,
  orgSlug: process.env.LEARNHOUSE_ORG_SLUG || "default",
};

// 用户会话只在本地进程中保留，缺失或失效时由用户完成人工点选验证码。
const client = new LearnHouseClient({
  baseUrl: config.baseUrl,
  accessToken: config.accessToken || undefined,
  orgId: config.orgId,
  orgSlug: config.orgSlug,
});
const captchaLogin = new CaptchaLogin({
  baseUrl: config.baseUrl,
  username: config.email,
  password: config.password,
  client,
});

async function getClient(): Promise<LearnHouseClient> {
  if (await client.getValidAccessToken()) return client;
  if (!config.email || !config.password) {
    throw new Error("请配置 LEARNHOUSE_API_TOKEN，或配置账号密码后通过人工验证码登录");
  }
  const url = await captchaLogin.start();
  throw new Error("请在本机浏览器打开 " + url + "，完成人工点选验证码后重试。");
}

const websiteApi = new WebsiteApi({
  baseUrl: config.baseUrl,
  orgId: config.orgId,
  orgUuid: config.orgUuid,
  getAccessToken: async () => (await getClient()).getAccessToken(),
  onUnauthorized: (token) => client.clearSession(token),
  getOrganizationUuid: async (orgId) => {
    if (orgId !== config.orgId) return undefined;
    const org = await (await getClient()).getOrganizationBySlug(config.orgSlug);
    return org.id === orgId ? org.org_uuid : undefined;
  },
});

// ============================================================
// MCP Server
// ============================================================

const server = new FastMCP({
  name: "LearnHouse MCP Server",
  version: "1.2.0",
  instructions: `
LearnHouse MCP Server provides tools to manage an LMS (Learning Management System).

Available capabilities:
- **Course Management**: List, create, update, delete courses
- **Chapter Management**: Organize chapters within courses
- **Activity Management**: Create and manage learning activities (documents, videos, PDFs)
- **Content Creation**: Set TipTap document content for activities
- **Progress Tracking**: Track user progress through courses
- **Search**: Search across courses and content
- **Website APIs**: Discover and call the current website API for question banks, exams, assignments, classes, learning reports, showcases, and other supported modules. First search, then inspect the selected operation before calling it. The website enforces the account permissions.
- **Secure login**: If a user session is needed, call start_login and ask the user to complete the Chinese click captcha in the local browser; never try to solve it automatically.

Organization ID: ${config.orgId}
API URL: ${config.baseUrl}
  `.trim(),
});

server.addTool({
  name: "ping",
  description: "Ping the MCP server to verify it is running and identify version.",
  parameters: z.object({}),
  execute: async () => {
    return "LearnHouse MCP Server is UP (Version 1.2.0)";
  },
});

// ============================================================
// Course Tools
// ============================================================

server.addTool({
  name: "list_courses",
  description: "List all courses in the organization",
  parameters: z.object({
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(50).describe("Number of courses per page"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const courses = await api.listCourses(args.page, args.limit);
    return JSON.stringify(courses, null, 2);
  },
});

server.addTool({
  name: "get_course",
  description: "Get detailed information about a specific course",
  parameters: z.object({
    course_uuid: z.string().describe("The UUID of the course"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const course = await api.getCourse(args.course_uuid);
    return JSON.stringify(course, null, 2);
  },
});

server.addTool({
  name: "create_course",
  description: "Create a new course",
  parameters: z.object({
    name: z.string().describe("Course name"),
    description: z.string().describe("Course description"),
    public: z.boolean().optional().default(true).describe("Whether the course is public"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const course = await api.createCourse({
      name: args.name,
      description: args.description,
      public: args.public,
      learnings: [],
    });
    return JSON.stringify(course, null, 2);
  },
});

server.addTool({
  name: "update_course",
  description: "Update an existing course",
  parameters: z.object({
    course_uuid: z.string().describe("The UUID of the course to update"),
    name: z.string().optional().describe("New course name"),
    description: z.string().optional().describe("New course description"),
    published: z.boolean().optional().describe("Publish/unpublish the course"),
    thumbnail_image: z.string().optional().describe("URL of the thumbnail image"),
    thumbnail_type: z.enum(["IMAGE", "VIDEO"]).optional().describe("Type of thumbnail"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const update: Record<string, unknown> = {};
    if (args.name) update.name = args.name;
    if (args.description) update.description = args.description;
    if (args.published !== undefined) update.published = args.published;
    if (args.thumbnail_image) update.thumbnail_image = args.thumbnail_image;
    if (args.thumbnail_type) update.thumbnail_type = args.thumbnail_type;
    
    const course = await api.updateCourse(args.course_uuid, update);
    return JSON.stringify(course, null, 2);
  },
});

server.addTool({
  name: "delete_course",
  description: "Delete a course (use with caution!)",
  parameters: z.object({
    course_uuid: z.string().describe("The UUID of the course to delete"),
  }),
  execute: async (args) => {
    const api = await getClient();
    await api.deleteCourse(args.course_uuid);
    return `Course ${args.course_uuid} deleted successfully`;
  },
});

server.addTool({
  name: "upload_course_thumbnail",
  description: "Upload a thumbnail image for a course from a local file path",
  parameters: z.object({
    course_uuid: z.string().describe("The UUID of the course"),
    file_path: z.string().describe("Local absolute path to the image file"),
    type: z.enum(["IMAGE", "VIDEO"]).optional().default("IMAGE").describe("Thumbnail type"),
  }),
  execute: async (args) => {
    const api = await getClient();
    
    if (!fs.existsSync(args.file_path)) {
      throw new Error(`File not found: ${args.file_path}`);
    }
    
    const buffer = fs.readFileSync(args.file_path);
    const fileName = path.basename(args.file_path);
    
    const course = await api.uploadCourseThumbnail(args.course_uuid, buffer, fileName, args.type);
    return JSON.stringify(course, null, 2);
  },
});

// ============================================================
// Chapter Tools
// ============================================================

server.addTool({
  name: "list_chapters",
  description: "List all chapters in a course",
  parameters: z.object({
    course_id: z.number().describe("The numeric ID of the course"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const chapters = await api.listChapters(args.course_id);
    return JSON.stringify(chapters, null, 2);
  },
});

server.addTool({
  name: "get_chapter",
  description: "Get details of a specific chapter",
  parameters: z.object({
    chapter_id: z.number().describe("The ID of the chapter"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const chapter = await api.getChapter(args.chapter_id);
    return JSON.stringify(chapter, null, 2);
  },
});

server.addTool({
  name: "create_chapter",
  description: "Create a new chapter in a course",
  parameters: z.object({
    course_id: z.number().describe("The numeric ID of the course"),
    org_id: z.number().optional().default(config.orgId).describe("Organization ID"),
    name: z.string().describe("Chapter name"),
    description: z.string().optional().default("").describe("Chapter description"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const chapter = await api.createChapter({
      name: args.name,
      description: args.description || "",
      course_id: args.course_id,
      org_id: args.org_id,
    });
    return JSON.stringify(chapter, null, 2);
  },
});

server.addTool({
  name: "update_chapter",
  description: "Update an existing chapter",
  parameters: z.object({
    chapter_id: z.number().describe("The ID of the chapter to update"),
    name: z.string().optional().describe("New chapter name"),
    description: z.string().optional().describe("New chapter description"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const update: Record<string, unknown> = {};
    if (args.name) update.name = args.name;
    if (args.description !== undefined) update.description = args.description;
    
    const chapter = await api.updateChapter(args.chapter_id, update);
    return JSON.stringify(chapter, null, 2);
  },
});

// ============================================================
// Activity Tools
// ============================================================

server.addTool({
  name: "list_activities",
  description: "List all activities in a chapter",
  parameters: z.object({
    chapter_id: z.number().describe("The ID of the chapter"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const activities = await api.listActivities(args.chapter_id);
    return JSON.stringify(activities, null, 2);
  },
});

server.addTool({
  name: "get_activity",
  description: "Get details of a specific activity",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const activity = await api.getActivity(args.activity_uuid);
    return JSON.stringify(activity, null, 2);
  },
});

server.addTool({
  name: "create_activity",
  description: "Create a new activity in a chapter",
  parameters: z.object({
    chapter_id: z.number().describe("The ID of the chapter"),
    name: z.string().describe("Activity name"),
    activity_type: z.enum(["TYPE_DYNAMIC", "TYPE_VIDEO", "TYPE_PDF"]).optional().default("TYPE_DYNAMIC").describe("Type of activity"),
    activity_sub_type: z.enum(["SUBTYPE_DYNAMIC_PAGE", "SUBTYPE_VIDEO_YOUTUBE", "SUBTYPE_VIDEO_HOSTED", "SUBTYPE_PDF"]).optional().default("SUBTYPE_DYNAMIC_PAGE").describe("Subtype of activity"),
    published: z.boolean().optional().default(false).describe("Whether the activity is published"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const activity = await api.createActivity({
      name: args.name,
      chapter_id: args.chapter_id,
      activity_type: args.activity_type as any,
      activity_sub_type: args.activity_sub_type as any,
      published: args.published,
    });
    return JSON.stringify(activity, null, 2);
  },
});

server.addTool({
  name: "update_activity",
  description: "Update an existing activity",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity to update"),
    name: z.string().optional().describe("New activity name"),
    published: z.boolean().optional().describe("Publish/unpublish the activity"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const update: Record<string, unknown> = {};
    if (args.name) update.name = args.name;
    if (args.published !== undefined) update.published = args.published;
    
    const activity = await api.updateActivity(args.activity_uuid, update);
    return JSON.stringify(activity, null, 2);
  },
});

server.addTool({
  name: "publish_activity",
  description: "Publish an activity to make it visible",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity to publish"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const activity = await api.updateActivity(args.activity_uuid, { published: true });
    return JSON.stringify(activity, null, 2);
  },
});

// ============================================================
// Content Tools
// ============================================================

server.addTool({
  name: "set_document_content",
  description: "Set the TipTap document content for a document activity. Content must be valid TipTap JSON.",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity"),
    content: z.string().describe("TipTap JSON content as a string"),
  }),
  execute: async (args) => {
    const api = await getClient();
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(args.content) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON content. Please provide valid TipTap JSON.");
    }
    
    await api.updateActivity(args.activity_uuid, { content });
    return `Document content updated for activity ${args.activity_uuid}`;
  },
});

server.addTool({
  name: "set_video_content",
  description: "Set video URL for a video activity",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity"),
    video_url: z.string().describe("YouTube or hosted video URL"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const activity = await api.updateActivity(args.activity_uuid, {
      content: { video_url: args.video_url },
    });
    return `Video URL set for activity ${args.activity_uuid}: ${args.video_url}`;
  },
});

// ============================================================
// User & Organization Tools
// ============================================================

server.addTool({
  name: "get_current_user",
  description: "Get information about the currently authenticated user",
  parameters: z.object({}),
  execute: async () => {
    const api = await getClient();
    const user = await api.getCurrentUser();
    return JSON.stringify(user, null, 2);
  },
});

server.addTool({
  name: "get_organization",
  description: "Get organization details",
  parameters: z.object({
    org_id: z.number().optional().default(config.orgId).describe("Organization ID"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const org = await api.getOrganization(args.org_id);
    return JSON.stringify(org, null, 2);
  },
});

// ============================================================
// Collection Tools
// ============================================================

server.addTool({
  name: "list_collections",
  description: "List all collections in the organization",
  parameters: z.object({
    page: z.number().optional().default(1).describe("Page number"),
    limit: z.number().optional().default(50).describe("Number of collections per page"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const collections = await api.listCollections(args.page, args.limit);
    return JSON.stringify(collections, null, 2);
  },
});

server.addTool({
  name: "get_collection",
  description: "Get detailed information about a specific collection",
  parameters: z.object({
    collection_uuid: z.string().describe("The UUID of the collection"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const collection = await api.getCollection(args.collection_uuid);
    return JSON.stringify(collection, null, 2);
  },
});

server.addTool({
  name: "create_collection",
  description: "Create a new collection",
  parameters: z.object({
    name: z.string().describe("Collection name"),
    description: z.string().optional().describe("Collection description"),
    public: z.boolean().optional().default(true).describe("Whether the collection is public"),
    courses: z.array(z.number()).optional().describe("List of course IDs to include"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const collection = await api.createCollection({
      name: args.name,
      description: args.description,
      public: args.public,
      courses: args.courses,
    });
    return JSON.stringify(collection, null, 2);
  },
});

server.addTool({
  name: "delete_collection",
  description: "Delete a collection",
  parameters: z.object({
    collection_uuid: z.string().describe("The UUID of the collection to delete"),
  }),
  execute: async (args) => {
    const api = await getClient();
    await api.deleteCollection(args.collection_uuid);
    return `Collection ${args.collection_uuid} deleted successfully`;
  },
});

// ============================================================
// Progress Tools
// ============================================================

server.addTool({
  name: "get_course_progress",
  description: "Get user's progress for a specific course",
  parameters: z.object({
    course_uuid: z.string().describe("The UUID of the course"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const progress = await api.getCourseProgress(args.course_uuid);
    return JSON.stringify(progress, null, 2);
  },
});

server.addTool({
  name: "mark_activity_complete",
  description: "Mark an activity as completed for the current user",
  parameters: z.object({
    activity_uuid: z.string().describe("The UUID of the activity to mark complete"),
  }),
  execute: async (args) => {
    const api = await getClient();
    await api.markActivityComplete(args.activity_uuid);
    return `Activity ${args.activity_uuid} marked as complete`;
  },
});

// ============================================================
// Search Tools
// ============================================================

server.addTool({
  name: "search",
  description: "Search for courses and content in the organization",
  parameters: z.object({
    org_slug: z.string().optional().default("default").describe("Organization slug"),
    query: z.string().describe("Search query"),
  }),
  execute: async (args) => {
    const api = await getClient();
    const results = await api.search(args.org_slug, args.query);
    return JSON.stringify(results, null, 2);
  },
});

server.addTool({
    name: "get_course_full",
    description: "Get full course hierarchy including chapters and activities",
    parameters: z.object({
        course_uuid: z.string().describe("The UUID of the course"),
    }),
    execute: async (args) => {
        const api = await getClient();
        const course = await api.getCourseMeta(args.course_uuid);
        return JSON.stringify(course, null, 2);
    },
});

server.addTool({
    name: "update_collection",
    description: "Update a collection",
    parameters: z.object({
        collection_uuid: z.string().describe("The UUID of the collection"),
        name: z.string().optional().describe("Collection name"),
        description: z.string().optional().describe("Collection description"),
        public: z.boolean().optional().describe("Whether the collection is public"),
    }),
    execute: async (args) => {
        const api = await getClient();
        const update: any = {};
        if (args.name) update.name = args.name;
        if (args.description) update.description = args.description;
        if (args.public !== undefined) update.public = args.public;
        
        const collection = await api.updateCollection(args.collection_uuid, update);
        return JSON.stringify(collection, null, 2);
    },
});

server.addTool({
  name: "import_course_package",
  description: "Import a LearnHouse course package (.zip) into the organization",
  parameters: z.object({
    zip_path: z.string().describe("Local absolute path to the course export zip file"),
  }),
  execute: async (args) => {
    const api = await getClient();
    if (!fs.existsSync(args.zip_path)) {
      throw new Error(`Course package not found: ${args.zip_path}`);
    }
    const buffer = fs.readFileSync(args.zip_path);
    const fileName = path.basename(args.zip_path);
    const analysis = await api.analyzeImportPackage(buffer, fileName);
    if (!analysis || !analysis.temp_id || !analysis.courses || analysis.courses.length === 0) {
      throw new Error(`Failed to analyze package: ${JSON.stringify(analysis)}`);
    }
    const courseUuids = analysis.courses.map((c: any) => c.course_uuid);
    const result = await api.importCoursesSync(analysis.temp_id, courseUuids);
    return JSON.stringify({ analysis, result }, null, 2);
  },
});

// ============================================================
// 安全登录
// ============================================================

server.addTool({
  name: "start_login",
  description: "启动仅本机可访问的人工汉字验证码登录页面；用户在页面完成点选后，MCP 使用其真实用户会话。",
  parameters: z.object({}),
  execute: async () => {
    if (await client.getValidAccessToken()) return JSON.stringify({ status: "authenticated" });
    const url = await captchaLogin.start();
    return JSON.stringify({ status: "waiting", url, message: "请在本机浏览器打开此地址，完成汉字点选后重试。" });
  },
});

server.addTool({
  name: "login_status",
  description: "查看本机人工验证码登录是否完成，不返回账号凭据或会话令牌。",
  parameters: z.object({}),
  execute: async () => {
    await client.getValidAccessToken();
    return JSON.stringify(captchaLogin.status());
  },
});

// ============================================================
// 网站接口发现与调用
// ============================================================

server.addTool({
  name: "website_api_search",
  description: "搜索当前 LearnHouse 网站的接口，覆盖题库、考试、作业、班级、学情、作品等模块；按中文关键词或路由搜索，返回操作标识。认证和凭据管理接口不在通用工具中开放。",
  parameters: z.object({
    query: z.string().optional().describe("中文或英文关键词，例如题库、考试、作业、班级、学情、作品"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("按 HTTP 方法筛选"),
    page: z.number().int().min(1).optional().default(1).describe("结果页码"),
    page_size: z.number().int().min(1).max(50).optional().default(20).describe("每页结果数量"),
  }),
  execute: async (args) => JSON.stringify(await websiteApi.search({
    query: args.query, method: args.method, page: args.page, pageSize: args.page_size,
  }), null, 2),
});

server.addTool({
  name: "website_api_describe",
  description: "查看网站接口的参数、请求格式和数据结构。调用网站接口前先用本工具核对必填字段和上传字段。",
  parameters: z.object({
    operation_id: z.string().min(1).describe("website_api_search 返回的操作标识"),
  }),
  execute: async (args) => JSON.stringify(await websiteApi.describe(args.operation_id), null, 2),
});

const websiteParameter = z.union([z.string(), z.number(), z.boolean()]);
server.addTool({
  name: "website_api_call",
  description: "调用当前网站接口目录中的指定操作，使用现有平台账号及网站权限；支持 JSON、表单、本地文件上传和文件下载。先搜索并查看接口说明，写入操作会实际修改线上数据。",
  parameters: z.object({
    operation_id: z.string().min(1).describe("网站接口操作标识"),
    path_params: z.record(websiteParameter).optional().describe("路径参数，字段名以接口说明为准"),
    query: z.record(z.union([websiteParameter, z.array(websiteParameter)])).optional().describe("查询参数；网站所需组织信息优先使用显式值，否则使用当前组织"),
    body: z.any().optional().describe("JSON 请求体或表单字段对象"),
    files: z.record(z.union([z.string(), z.array(z.string())])).optional().describe("上传表单字段到本地绝对文件路径的映射"),
    output_path: z.string().optional().describe("下载文件保存到本地的绝对路径；不覆盖已有文件"),
  }),
  execute: async (args) => JSON.stringify(await websiteApi.call({
    operationId: args.operation_id, pathParams: args.path_params, query: args.query,
    body: args.body, files: args.files, outputPath: args.output_path,
  }), null, 2),
});

// ============================================================
// Start Server
// ============================================================

server.start({
  transportType: "stdio",
});

console.error("LearnHouse MCP Server started");
