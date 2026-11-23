# LearnHouse MCP Server

> **Model Context Protocol (MCP) Server for LearnHouse LMS**

This MCP server provides AI agents (like GitHub Copilot, Claude, and other AI assistants) with the ability to programmatically manage a LearnHouse Learning Management System instance.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Available Tools](#available-tools)
- [Data Models](#data-models)
- [Usage Examples](#usage-examples)
- [VS Code Integration](#vs-code-integration)
- [API Reference](#api-reference)
- [Testing Results](#testing-results)
- [Troubleshooting](#troubleshooting)

---

## Overview

### What is MCP?

The **Model Context Protocol (MCP)** is an open standard developed by Anthropic that enables AI assistants to interact with external systems through a standardized interface. Instead of hardcoding integrations, MCP allows AI models to discover and use tools dynamically.

### What does this server do?

The LearnHouse MCP Server exposes 30 dedicated tools plus website API discovery and calling tools that allow AI agents to:

- **Manage Courses**: Create, read, update, delete courses
- **Organize Chapters**: Structure course content into chapters
- **Create Activities**: Add learning materials (documents, videos, PDFs)
- **Set Content**: Populate activities with TipTap documents or video URLs
- **Track Progress**: Monitor user progress through courses
- **Search**: Find courses and content across the organization

### Why use MCP instead of direct API calls?

1. **Standardized Interface**: AI models can discover tools automatically
2. **Type Safety**: Zod schemas validate all parameters
3. **Authentication Handled**: One-time login, persistent session
4. **Error Handling**: Consistent error responses
5. **Multi-Agent Ready**: Any MCP-compatible agent can use these tools

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code / AI Agent                        │
│                   (GitHub Copilot, Claude, etc.)                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ stdio (JSON-RPC)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LearnHouse MCP Server                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     FastMCP Framework                     │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐│    │
│  │  │ Course  │ │ Chapter │ │Activity │ │ Progress/Search ││    │
│  │  │  Tools  │ │  Tools  │ │  Tools  │ │     Tools       ││    │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────────┬────────┘│    │
│  └───────┼───────────┼───────────┼───────────────┼─────────┘    │
│          │           │           │               │               │
│  ┌───────┴───────────┴───────────┴───────────────┴─────────┐    │
│  │                  LearnHouseClient (API Wrapper)          │    │
│  │  • Authentication (login, token management)              │    │
│  │  • HTTP Methods (GET, POST, PUT, DELETE)                 │    │
│  │  • Error Handling                                        │    │
│  └─────────────────────────────┬───────────────────────────┘    │
└────────────────────────────────┼────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LearnHouse API (FastAPI)                      │
│                   http://localhost:3000                          │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component            | File               | Description                       |
| -------------------- | ------------------ | --------------------------------- |
| **MCP Server**       | `src/index.ts`     | Tool definitions with Zod schemas |
| **API Client**       | `src/client.ts`    | LearnHouseClient wrapper class    |
| **Type Definitions** | `src/types.ts`     | TypeScript interfaces & enums     |
| **Configuration**    | `.vscode/mcp.json` | VS Code MCP server config         |

---

## Installation & Setup

### Prerequisites

- **Node.js** 18+
- **pnpm** (or npm/yarn)
- **LearnHouse instance** with admin credentials
- **VS Code** with GitHub Copilot (for integration)

### Install Dependencies

```bash
pnpm install
```

### Build (for production)

```bash
pnpm build
```

### Run in Development Mode

```bash
pnpm dev
```

### Test the Server

```bash
# Inspect available tools
pnpm inspect

# Run API tests
pnpm test
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| LEARNHOUSE_URL / LEARNHOUSE_API_URL | Platform base URL; LEARNHOUSE_URL takes precedence | http://localhost:3000 |
| LEARNHOUSE_API_TOKEN / LEARNHOUSE_ACCESS_TOKEN | Existing platform API token or user access token | Not set |
| LEARNHOUSE_EMAIL / LEARNHOUSE_PASSWORD | Username or email and password when no token is configured | Not set |
| LEARNHOUSE_ORG_ID | Default organization ID | 1 |
| LEARNHOUSE_ORG_UUID | Optional UUID for the default organization | Automatically looked up when permitted |
| LEARNHOUSE_ORG_SLUG | Slug used for default-organization lookup | default |

Do not commit real passwords or tokens. The website enforces the configured account's permissions. Some operations require a real user session and reject API tokens.

### VS Code Configuration

An example MCP configuration for VS Code is shown below:

```json
{
  "servers": {
    "learnhouse": {
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/src/index.ts"],
      "env": {
        "LEARNHOUSE_URL": "http://localhost:3000",
        "LEARNHOUSE_EMAIL": "admin@example.com",
        "LEARNHOUSE_PASSWORD": "YourPassword",
        "LEARNHOUSE_ORG_ID": "1"
      }
    }
  }
}
```

---

## 安全登录与会话

使用账号密码连接时，MCP 不再读取或自动求解验证码答案。首次需要真实用户会话时调用 start_login，并在本机浏览器打开返回的地址，按照图片提示手动点选汉字；完成后可调用 login_status 查看状态，再重试原任务。若直接调用业务工具，未登录时也会返回同一登录地址。

登录页面只监听本机回环地址，链接有随机标识和时效；密码、验证码令牌和登录令牌不会显示在页面或工具结果中。登录成功后，会话仅保存在当前 MCP 进程内，访问令牌将按平台规则自动刷新；进程重启后需要重新点选。仅使用允许 API Token 的接口时，也可配置 LEARNHOUSE_API_TOKEN 或 LEARNHOUSE_ACCESS_TOKEN，无需账号密码登录；作业、班级管理、正式比赛等需遵循网站的真实用户会话限制。

独立脚本如使用账号密码，应由人工完成验证码后，通过受保护的环境变量 LEARNHOUSE_VERIFIED_CAPTCHA_TOKEN 提供验证成功令牌；不要将真实凭据或令牌写入仓库或聊天。

---

## 网站接口对齐

当前 MCP 按已配置的网站地址读取实时 OpenAPI 接口目录，保留原有课程工具，并提供三个通用工具：

1. website_api_search：按“题库、考试、作业、班级、学情、作品”等关键词查找接口，也可按 HTTP 方法筛选。
2. website_api_describe：查看选中操作的路径、参数、请求体和相关数据结构。
3. website_api_call：调用该操作，支持 JSON、表单、本地文件上传和文件下载。

例如，先搜索“题库”，找到列出本地题目的操作，再查看其参数并调用。当前线上版本的操作标识可由搜索结果获取，无需手写；网站更新接口后，目录缓存最多保留五分钟，加载失败时使用已缓存的目录。

网站的部分接口在 OpenAPI 文档中漏写了组织参数。MCP 对题库、考试、作业、作品、智能实验室和任务管理等相关接口补充 org_id，必要时尝试按当前组织 slug 查找 org_uuid。显式传入的组织参数优先；切换到其他组织时，请明确提供对应 org_uuid。若 API Token 无权读取组织信息，可配置 LEARNHOUSE_ORG_UUID，或在请求中提供 org_uuid。

通用调用仅访问配置网站的已声明 API，不跟随重定向；登录、密码、API Token 管理、单点登录票据和内部密钥接口不通过此工具暴露。实际数据访问和写入仍受网站权限控制，作业、班级管理、正式比赛等有各自的真实用户会话限制，不会绕过。

请求支持 application/json、multipart/form-data 和 application/x-www-form-urlencoded。files 将表单字段映射到本机绝对文件路径；下载时通过 output_path 指定新的绝对文件路径，不覆盖已有文件。单文件上传和下载上限为 50 MB，普通返回内容上限为 5 MB；实时事件流暂不支持，可改查普通结果接口。网站没有提供接口的纯界面操作仍需要使用网页。

运行回归测试：npm run test:website。

---

## Available Tools

### Course Management (5 tools)

| Tool            | Description                          | Parameters                                           |
| --------------- | ------------------------------------ | ---------------------------------------------------- |
| `list_courses`  | List all courses in the organization | `page?`, `limit?`                                    |
| `get_course`    | Get detailed course information      | `course_uuid`                                        |
| `create_course` | Create a new course                  | `name`, `description`, `public?`                     |
| `update_course` | Update an existing course            | `course_uuid`, `name?`, `description?`, `published?` |
| `delete_course` | Delete a course                      | `course_uuid`                                        |

### Chapter Management (4 tools)

| Tool             | Description                   | Parameters                                     |
| ---------------- | ----------------------------- | ---------------------------------------------- |
| `list_chapters`  | List all chapters in a course | `course_id`                                    |
| `get_chapter`    | Get chapter details           | `chapter_id`                                   |
| `create_chapter` | Create a new chapter          | `course_id`, `name`, `description?`, `org_id?` |
| `update_chapter` | Update a chapter              | `chapter_id`, `name?`, `description?`          |

### Activity Management (6 tools)

| Tool                   | Description                      | Parameters                                                                 |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `list_activities`      | List all activities in a chapter | `chapter_id`                                                               |
| `get_activity`         | Get activity details             | `activity_uuid`                                                            |
| `create_activity`      | Create a new activity            | `chapter_id`, `name`, `activity_type?`, `activity_sub_type?`, `published?` |
| `update_activity`      | Update an activity               | `activity_uuid`, `name?`, `published?`                                     |
| `publish_activity`     | Publish an activity              | `activity_uuid`                                                            |
| `set_document_content` | Set TipTap document content      | `activity_uuid`, `content` (JSON string)                                   |

### Content Tools (1 tool)

| Tool                | Description                | Parameters                   |
| ------------------- | -------------------------- | ---------------------------- |
| `set_video_content` | Set video URL for activity | `activity_uuid`, `video_url` |

### User & Organization (2 tools)

| Tool               | Description                 | Parameters |
| ------------------ | --------------------------- | ---------- |
| `get_current_user` | Get authenticated user info | None       |
| `get_organization` | Get organization details    | `org_id?`  |

### Progress Tracking (2 tools)

| Tool                     | Description                | Parameters      |
| ------------------------ | -------------------------- | --------------- |
| `get_course_progress`    | Get user's course progress | `course_uuid`   |
| `mark_activity_complete` | Mark activity as completed | `activity_uuid` |

### Search (1 tool)

| Tool     | Description                | Parameters           |
| -------- | -------------------------- | -------------------- |
| `search` | Search courses and content | `query`, `org_slug?` |

---

## Data Models

### Activity Types

```typescript
enum ActivityType {
  TYPE_DYNAMIC = "TYPE_DYNAMIC", // Rich text document (TipTap)
  TYPE_VIDEO = "TYPE_VIDEO", // Video content
  TYPE_DOCUMENT = "TYPE_DOCUMENT", // PDF or document
  TYPE_ASSIGNMENT = "TYPE_ASSIGNMENT", // Assignment
  TYPE_CUSTOM = "TYPE_CUSTOM", // Custom type
}

enum ActivitySubType {
  SUBTYPE_DYNAMIC_PAGE = "SUBTYPE_DYNAMIC_PAGE", // TipTap editor page
  SUBTYPE_VIDEO_YOUTUBE = "SUBTYPE_VIDEO_YOUTUBE", // YouTube embed
  SUBTYPE_VIDEO_HOSTED = "SUBTYPE_VIDEO_HOSTED", // Self-hosted video
  SUBTYPE_DOCUMENT_PDF = "SUBTYPE_DOCUMENT_PDF", // PDF viewer
  SUBTYPE_DOCUMENT_DOC = "SUBTYPE_DOCUMENT_DOC", // Document
}
```

### TipTap Document Structure

LearnHouse uses **TipTap** as its rich text editor. Content is stored as JSON:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Welcome" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "This is a paragraph." }]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "content": [{ "type": "text", "text": "Item 1" }]
            }
          ]
        }
      ]
    }
  ]
}
```

### Course Structure

```
Organization (org_id: 1)
└── Course (course_uuid)
    ├── name: string
    ├── description: string
    ├── public: boolean
    ├── published: boolean
    └── chapters[]
        └── Chapter (chapter_id, chapter_uuid)
            ├── name: string
            ├── description: string
            └── activities[]
                └── Activity (activity_uuid)
                    ├── name: string
                    ├── activity_type: ActivityType
                    ├── activity_sub_type: ActivitySubType
                    ├── content: TipTapDocument | VideoContent
                    └── published: boolean
```

---

## Usage Examples

### Example 1: Create a Complete Course

```
User: Create a course called "Python Fundamentals" with two chapters

AI Agent (using MCP tools):
1. create_course(name: "Python Fundamentals", description: "Learn Python basics")
   → Returns course_uuid: "course_abc123"

2. create_chapter(course_id: 15, name: "Getting Started")
   → Returns chapter_id: 70

3. create_chapter(course_id: 15, name: "Variables & Data Types")
   → Returns chapter_id: 71

4. create_activity(chapter_id: 70, name: "Introduction to Python", activity_type: "TYPE_DYNAMIC")
   → Returns activity_uuid: "activity_xyz789"

5. set_document_content(activity_uuid: "activity_xyz789", content: {...tiptap json...})
   → Content saved

6. publish_activity(activity_uuid: "activity_xyz789")
   → Activity published
```

### Example 2: Add a YouTube Video

```
User: Add a YouTube tutorial to chapter 70

AI Agent (using MCP tools):
1. create_activity(
     chapter_id: 70,
     name: "Python Tutorial Video",
     activity_type: "TYPE_VIDEO",
     activity_sub_type: "SUBTYPE_VIDEO_YOUTUBE"
   )
   → Returns activity_uuid: "activity_video123"

2. set_video_content(
     activity_uuid: "activity_video123",
     video_url: "https://www.youtube.com/watch?v=example"
   )
   → Video URL set

3. publish_activity(activity_uuid: "activity_video123")
   → Published
```

### Example 3: Search and Update

```
User: Find all courses about MCP and update their descriptions

AI Agent (using MCP tools):
1. search(query: "MCP")
   → Returns: [{course_uuid: "course_mcp1", name: "MCP Introduction"}]

2. update_course(
     course_uuid: "course_mcp1",
     description: "Updated description for MCP course"
   )
   → Course updated
```

---

## VS Code Integration

### How It Works

1. **VS Code loads `mcp.json`** at startup
2. **Starts the MCP server** as a subprocess
3. **Tools become available** to GitHub Copilot
4. **AI agent discovers tools** via MCP protocol
5. **Tools execute** and return results

### Verifying the Server

In VS Code:

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Developer: Show MCP Tools"
3. You should see all 21 LearnHouse tools

### Using with Copilot

Simply ask Copilot to perform LearnHouse operations:

> "List all courses in LearnHouse"
> "Create a new chapter called 'Introduction' in course 5"
> "Search for courses about Python"

---

## API Reference

### Base URL

```
http://localhost:3000/api/v1
```

### Authentication

The client uses **OAuth2 password flow**:

```
POST /auth/login
Content-Type: application/x-www-form-urlencoded

username=admin@example.com&password=YourPassword
```

Returns:

```json
{
  "user": { "id": 1, "email": "admin@example.com", ... },
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ..."
  }
}
```

### Key Endpoints

| Method | Endpoint                                      | Description     |
| ------ | --------------------------------------------- | --------------- |
| GET    | `/courses/org_slug/{slug}/page/{p}/limit/{l}` | List courses    |
| GET    | `/courses/{uuid}`                             | Get course      |
| POST   | `/courses/`                                   | Create course   |
| PUT    | `/courses/{uuid}`                             | Update course   |
| DELETE | `/courses/{uuid}`                             | Delete course   |
| GET    | `/chapters/{id}`                              | Get chapter     |
| POST   | `/chapters/`                                  | Create chapter  |
| PUT    | `/chapters/{id}`                              | Update chapter  |
| GET    | `/activities/{uuid}`                          | Get activity    |
| POST   | `/activities/`                                | Create activity |
| PUT    | `/activities/{uuid}`                          | Update activity |
| GET    | `/search/org_slug/{slug}?query=`              | Search          |

---

## Testing Results

### Tool Verification (January 23, 2026)

| #   | Tool                     | Status       | Notes                            |
| --- | ------------------------ | ------------ | -------------------------------- |
| 1   | `list_courses`           | ✅ Pass      | 12 courses returned              |
| 2   | `get_course`             | ✅ Pass      | Course details retrieved         |
| 3   | `create_course`          | ✅ Pass      | Created course id=13             |
| 4   | `update_course`          | ✅ Pass      | Name updated                     |
| 5   | `delete_course`          | ✅ Pass      | Course deleted                   |
| 6   | `list_chapters`          | ❌ API Error | HTTP 500 (backend issue)         |
| 7   | `get_chapter`            | ✅ Pass      | Chapter details retrieved        |
| 8   | `create_chapter`         | ✅ Pass      | Created chapter id=62            |
| 9   | `update_chapter`         | ✅ Pass      | Name/description updated         |
| 10  | `list_activities`        | ✅ Pass      | Activities listed                |
| 11  | `get_activity`           | ✅ Pass      | Activity details retrieved       |
| 12  | `create_activity`        | ✅ Pass      | Created activities (doc & video) |
| 13  | `update_activity`        | ✅ Pass      | Name updated                     |
| 14  | `publish_activity`       | ✅ Pass      | Activity published               |
| 15  | `set_document_content`   | ✅ Pass      | TipTap content set               |
| 16  | `set_video_content`      | ✅ Pass      | YouTube URL set                  |
| 17  | `get_current_user`       | ✅ Pass      | admin@example.com                |
| 18  | `get_organization`       | ✅ Pass      | AgentOne org details             |
| 19  | `search`                 | ✅ Pass      | Found courses                    |
| 20  | `get_course_progress`    | ❌ API Error | Requires enrollment              |
| 21  | `mark_activity_complete` | ❌ API Error | Requires enrollment              |

**Result: 18/21 tools working (86% success rate)**

The 3 failing tools have backend API issues, not MCP server bugs.

---

## Troubleshooting

### Server won't start

```bash
# Check Node.js version
node --version  # Should be 18+

# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### Authentication fails

1. Verify credentials in environment variables
2. Check if user exists in LearnHouse
3. Ensure user has admin permissions

### Tool returns "Not Found"

- Verify the UUID/ID exists
- Check if the resource is in the correct organization
- Some endpoints require user enrollment (progress tools)

### "Cannot find module" error

```bash
# Rebuild TypeScript
pnpm build
```

### VS Code doesn't show tools

1. Reload VS Code window
2. Check `.vscode/mcp.json` syntax
3. View Output → "MCP" channel for errors

---

## Dependencies

| Package      | Version | Purpose              |
| ------------ | ------- | -------------------- |
| `fastmcp`    | ^3.29.0 | MCP framework        |
| `zod`        | ^3.23.8 | Schema validation    |
| `typescript` | ^5.x    | Type safety          |
| `tsx`        | ^4.x    | TypeScript execution |

---

## License

MIT License - See [LICENSE](../LICENSE)

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes to `src/`
4. Test with `pnpm inspect`
5. Submit a pull request

---

## Related Documentation

- [LearnHouse API Docs](https://docs.learnhouse.app)
- [MCP Specification](https://modelcontextprotocol.io)
- [FastMCP GitHub](https://github.com/punkpeye/fastmcp)
- [TipTap Documentation](https://tiptap.dev/docs)
