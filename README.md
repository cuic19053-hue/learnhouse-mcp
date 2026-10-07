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

The LearnHouse MCP Server exposes **21 tools** that allow AI agents to:

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

| Variable              | Description                    | Default                 |
| --------------------- | ------------------------------ | ----------------------- |
| `LEARNHOUSE_URL`      | Base URL of LearnHouse API     | `http://localhost:3000` |
| `LEARNHOUSE_EMAIL`    | Admin email for authentication | Required                |
| `LEARNHOUSE_PASSWORD` | Admin password                 | Required                |
| `LEARNHOUSE_ORG_ID`   | Organization ID                | `1`                     |

### VS Code Configuration

The MCP server is configured in `.vscode/mcp.json`:

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
