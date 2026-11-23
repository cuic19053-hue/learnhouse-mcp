import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebsiteApi } from "../website-api.js";
import { LearnHouseClient } from "../client.js";

const jsonContent = { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } };
const specification = {
  openapi: "3.1.0",
  paths: {
    "/api/v1/local-problem/problems": {
      get: {
        operationId: "list_problems", summary: "获取题目列表", tags: ["local-problem"],
        parameters: [
          { name: "org_id", in: "query", required: true, schema: { type: "integer" } },
          { name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
        ],
      },
      post: {
        operationId: "create_problem", summary: "创建题目", tags: ["local-problem"],
        requestBody: { required: true, content: jsonContent },
      },
    },
    "/api/v1/local-problem/problems/{problem_id}": {
      get: {
        operationId: "get_problem", summary: "获取题目详情", tags: ["local-problem"],
        parameters: [{ name: "problem_id", in: "path", required: true, schema: { type: "string" } }],
      },
    },
    "/api/v1/import": {
      post: { operationId: "import_problem", summary: "导入题目", requestBody: {
        required: true, content: { "multipart/form-data": { schema: { type: "object" } } },
      } },
    },
    "/api/v1/export": { get: { operationId: "export_problems", summary: "导出题目" } },
    "/api/v1/exam/papers": { get: { operationId: "list_papers", summary: "获取试卷" } },
    "/api/v1/events": { get: { operationId: "events", summary: "实时事件" } },
    "/api/v1/failure": { get: { operationId: "failure", summary: "失败示例" } },
    "/api/v1/unauthorized": { get: { operationId: "unauthorized", summary: "会话失效" } },
    "/api/v1/redirect": { get: { operationId: "redirect", summary: "重定向" } },
    "/api/v1/auth/login": { post: { operationId: "login", summary: "登录" } },
    "/api/v1/noi-sso/ticket": { post: { operationId: "ticket", summary: "单点登录票据" } },
    "/api/v1/orgs/{org_id}/api-tokens": { post: { operationId: "create_token", summary: "创建令牌" } },
    "/api/v1/users/change_password/{user_id}": { put: { operationId: "password", summary: "更改密码" } },
    "/api/v1/internal": { get: { operationId: "internal", parameters: [{ name: "x-internal-key", in: "header" }] } },
  },
  components: { schemas: {
    Problem: { type: "object", required: ["name"], properties: { name: { type: "string" }, details: { $ref: "#/components/schemas/Details" } } },
    Details: { type: "object", properties: { difficulty: { type: "string" } } },
  } },
};

interface CapturedRequest { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }
const captured: CapturedRequest[] = [];
let catalogRequests = 0;
let loginRequests = 0;
let refreshRequests = 0;
let baseUrl = "";
let temporaryDirectory = "";

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const url = new URL(req.url || "/", "http://localhost");
  captured.push({ method: req.method || "", url: req.url || "", headers: req.headers, body });
  if (url.pathname === "/api/v1/openapi.json") {
    catalogRequests++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(specification));
  } else if (url.pathname === "/api/v1/auth/captcha") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      token: "opaque-test-challenge", image: "data:image/png;base64,aGVsbG8=",
      prompt: ["天"], width: 300, height: 160,
    }));
  } else if (url.pathname === "/api/v1/auth/captcha/verify") {
    const value = JSON.parse(body.toString()) as { token: string; clicks: Array<{ x: number; y: number }> };
    if (value.token !== "opaque-test-challenge" || value.clicks[0]?.x !== 30 || value.clicks[0]?.y !== 40) {
      res.writeHead(400).end();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "verified-test-captcha" }));
    }
  } else if (url.pathname === "/api/v1/auth/login") {
    loginRequests++;
    const form = new URLSearchParams(body.toString());
    if (form.get("captcha_token") !== "verified-test-captcha") return void res.writeHead(400).end();
    await new Promise((resolve) => setTimeout(resolve, 40));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tokens: {
      access_token: "test-session-token", refresh_token: "test-refresh-token",
      expiry: Date.now() + (form.get("username") === "refresh-user" ? 1000 : 3_600_000),
    } }));
  } else if (url.pathname === "/api/v1/auth/refresh") {
    refreshRequests++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ access_token: "refreshed-test-token", refresh_token: "rotated-test-token", expiry: Date.now() + 3_600_000 }));
  } else if (url.pathname === "/api/v1/events") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: running\n\n");
  } else if (url.pathname === "/api/v1/failure") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "权限不足" }));
  } else if (url.pathname === "/api/v1/unauthorized") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "会话失效" }));
  } else if (url.pathname === "/api/v1/redirect") {
    res.writeHead(302, { location: "/api/v1/local-problem/problems" });
    res.end();
  } else if (url.pathname === "/api/v1/export") {
    res.writeHead(200, { "content-type": "application/zip" });
    res.end("fake-zip");
  } else if (url.pathname === "/api/v1/exam/papers" && (!url.searchParams.get("org_id") || !url.searchParams.get("org_uuid"))) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "缺少组织信息" }));
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, method: req.method, query: Object.fromEntries(url.searchParams) }));
  }
}

const server = createServer((req, res) => { void handle(req, res); });

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = "http://127.0.0.1:" + address.port;
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "learnhouse-website-tests-"));
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

function api(): WebsiteApi {
  return new WebsiteApi({ baseUrl, orgId: 7, getAccessToken: async () => "test-token" });
}

test("搜索实时目录并过滤凭据与内部接口", async () => {
  const website = api();
  const firstCount = catalogRequests;
  const result = await website.search({ query: "题库", pageSize: 50 });
  assert.equal(result.restricted_operations, 5);
  const found = (result.results as Array<{ operation_id: string }>).map((item) => item.operation_id);
  for (const id of ["list_problems", "create_problem", "get_problem"]) assert(found.includes(id));
  const all = await website.search({ pageSize: 50 });
  assert(!JSON.stringify(all).includes("create_token"));
  assert.equal(catalogRequests, firstCount + 1);
  await assert.rejects(website.describe("login"), /不存在或不允许/);
  await assert.rejects(website.call({ operationId: "ticket" }), /不存在或不允许/);
});

test("查看请求结构并递归提供引用的模型", async () => {
  const result = await api().describe("create_problem");
  const schemas = result.referenced_schemas as Record<string, unknown>;
  assert(schemas.Problem);
  assert(schemas.Details);
  assert.equal(result.schemas_truncated, false);
});

test("自动传组织、保留重复查询参数并携带已登录身份", async () => {
  const result = await api().call({ operationId: "list_problems", query: { tag: ["循环", "数组"] } });
  assert.equal(result.status, 200);
  const request = captured.at(-1)!;
  const url = new URL(request.url, baseUrl);
  assert.equal(url.searchParams.get("org_id"), "7");
  assert.deepEqual(url.searchParams.getAll("tag"), ["循环", "数组"]);
  assert.equal(request.headers.authorization, "Bearer test-token");
});

test("兼容网站文档遗漏的组织参数且不混用其他组织", async () => {
  let lookups = 0;
  const website = new WebsiteApi({
    baseUrl, orgId: 7, getAccessToken: async () => "test-token",
    getOrganizationUuid: async (id) => { lookups++; return id === 7 ? "org-seven" : undefined; },
  });
  const description = await website.describe("list_papers");
  const parameters = description.parameters as Array<{ name: string }>;
  assert(parameters.some((parameter) => parameter.name === "org_id"));
  assert(parameters.some((parameter) => parameter.name === "org_uuid"));
  await website.call({ operationId: "list_papers" });
  await website.call({ operationId: "list_papers" });
  assert.equal(lookups, 1);
  let url = new URL(captured.at(-1)!.url, baseUrl);
  assert.equal(url.searchParams.get("org_id"), "7");
  assert.equal(url.searchParams.get("org_uuid"), "org-seven");
  await website.call({ operationId: "list_papers", query: { org_id: 8, org_uuid: "org-eight" } });
  url = new URL(captured.at(-1)!.url, baseUrl);
  assert.equal(url.searchParams.get("org_id"), "8");
  assert.equal(url.searchParams.get("org_uuid"), "org-eight");
  assert.equal(lookups, 1);
  await assert.rejects(website.call({ operationId: "list_papers", query: { org_id: [8] } }), /组织 ID/);
  await assert.rejects(website.call({ operationId: "list_papers", query: { org_uuid: ["org-seven"] } }), /组织 UUID/);
});

test("组织信息临时查询失败后可以重试", async () => {
  let lookups = 0;
  const website = new WebsiteApi({
    baseUrl, orgId: 7, getAccessToken: async () => "test-token",
    getOrganizationUuid: async () => {
      lookups++;
      if (lookups === 1) throw new Error("临时故障");
      return "org-seven";
    },
  });
  await assert.rejects(website.call({ operationId: "list_papers" }), /HTTP 400/);
  await website.call({ operationId: "list_papers" });
  assert.equal(lookups, 2);
});

test("JSON 写入只发送到声明的路径并拒绝无效参数", async () => {
  const website = api();
  await website.call({ operationId: "create_problem", body: { name: "测试题" } });
  const request = captured.at(-1)!;
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(request.body.toString()), { name: "测试题" });
  await assert.rejects(website.call({ operationId: "create_problem" }), /需要请求内容/);
  await assert.rejects(website.call({ operationId: "list_problems", query: { unknown: "x" } }), /未知查询参数/);
  await assert.rejects(website.call({ operationId: "get_problem", pathParams: { problem_id: "../private" } }), /路径参数无效/);
  await website.call({ operationId: "get_problem", pathParams: { problem_id: "题目 1" } });
  assert(captured.at(-1)!.url.includes("%E9%A2%98%E7%9B%AE%201"));
});

test("上传本地文件并以 multipart 提交", async () => {
  const filePath = path.join(temporaryDirectory, "problems.zip");
  await fs.writeFile(filePath, "fake-upload");
  await api().call({ operationId: "import_problem", body: { title: "练习" }, files: { file: filePath } });
  const request = captured.at(-1)!;
  assert.match(String(request.headers["content-type"]), /^multipart\/form-data; boundary=/);
  const body = request.body.toString();
  assert.match(body, /name="title"/);
  assert.match(body, /filename="problems.zip"/);
  assert.match(body, /fake-upload/);
  await assert.rejects(api().call({ operationId: "import_problem", files: { file: "relative.zip" } }), /绝对路径/);
});

test("二进制下载保存到新文件且不覆盖已有文件", async () => {
  const target = path.join(temporaryDirectory, "export.zip");
  const website = api();
  await website.call({ operationId: "export_problems", outputPath: target });
  assert.equal(await fs.readFile(target, "utf8"), "fake-zip");
  const requestCount = captured.length;
  await assert.rejects(website.call({ operationId: "export_problems", outputPath: target }), /EEXIST/);
  assert.equal(captured.length, requestCount);
  assert.equal(await fs.readFile(target, "utf8"), "fake-zip");
  await assert.rejects(website.call({ operationId: "export_problems" }), /output_path/);
  const failedTarget = path.join(temporaryDirectory, "failed.zip");
  await assert.rejects(website.call({ operationId: "failure", outputPath: failedTarget }), /HTTP 403/);
  await assert.rejects(fs.stat(failedTarget), /ENOENT/);
});

test("保留网站错误，拒绝重定向和无界实时流", async () => {
  const website = api();
  await assert.rejects(website.call({ operationId: "failure" }), /HTTP 403.*权限不足/);
  await assert.rejects(website.call({ operationId: "redirect" }));
  await assert.rejects(website.call({ operationId: "events" }), /实时事件流/);
});

test("客户端要求已验证令牌，并在并发请求时只刷新一次会话", async () => {
  const client = new LearnHouseClient({ baseUrl, orgId: 7 });
  const before = captured.length;
  await assert.rejects(client.login("test-user", "test-password"), /人工点选验证码/);
  assert.equal(captured.length, before);
  await client.login("refresh-user", "test-password", "verified-test-captcha");
  const beforeRefresh = refreshRequests;
  const tokens = await Promise.all([client.getValidAccessToken(), client.getValidAccessToken()]);
  assert.deepEqual(tokens, ["refreshed-test-token", "refreshed-test-token"]);
  assert.equal(refreshRequests, beforeRefresh + 1);
  const refresh = captured.filter((request) => request.url === "/api/v1/auth/refresh").at(-1)!;
  assert.equal(refresh.headers.cookie, "LH_refresh=test-refresh-token");
  const directClient = new LearnHouseClient({ baseUrl, orgId: 7 });
  await directClient.login("refresh-user", "test-password", "verified-test-captcha");
  const beforeDirect = refreshRequests;
  await directClient.getCurrentUser();
  assert.equal(refreshRequests, beforeDirect + 1);
  assert.equal(captured.at(-1)!.headers.authorization, "Bearer refreshed-test-token");
  directClient.setAccessToken("newer-test-token");
  directClient.clearSession("older-test-token");
  assert.equal(directClient.getAccessToken(), "newer-test-token");
  const racingClient = new LearnHouseClient({ baseUrl, orgId: 7 });
  await racingClient.login("refresh-user", "test-password", "verified-test-captcha");
  const refreshing = racingClient.getValidAccessToken();
  racingClient.setAccessToken("replacement-token");
  assert.equal(await refreshing, "replacement-token");
  assert.equal(racingClient.getAccessToken(), "replacement-token");
});

test("已配置 API Token 时无需人工验证码即可访问允许的接口", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH || "", HOME: process.env.HOME || "", LEARNHOUSE_URL: baseUrl,
      LEARNHOUSE_ORG_ID: "7", LEARNHOUSE_API_TOKEN: "test-api-token",
      LEARNHOUSE_ACCESS_TOKEN: "", LEARNHOUSE_EMAIL: "", LEARNHOUSE_PASSWORD: "",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "learnhouse-token-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const beforeLogin = loginRequests;
    const result = await client.callTool({ name: "website_api_call", arguments: { operation_id: "list_problems" } });
    assert(!result.isError);
    assert.equal(loginRequests, beforeLogin);
    assert.equal(captured.at(-1)!.headers.authorization, "Bearer test-api-token");
    const login = await client.callTool({ name: "start_login", arguments: {} });
    const text = (login.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert(text);
    assert.equal((JSON.parse(text) as { status: string }).status, "authenticated");
  } finally {
    await client.close();
  }
});

test("通过 MCP 协议要求真实点选并在本机完成登录", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH || "", HOME: process.env.HOME || "", LEARNHOUSE_URL: baseUrl,
      LEARNHOUSE_ORG_ID: "7", LEARNHOUSE_EMAIL: "test-user", LEARNHOUSE_PASSWORD: "test-password",
      LEARNHOUSE_API_TOKEN: "", LEARNHOUSE_ACCESS_TOKEN: "",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "learnhouse-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of ["list_courses", "start_login", "login_status", "website_api_search", "website_api_describe", "website_api_call"]) {
      assert(names.includes(name), "缺少 MCP 工具 " + name);
    }
    const search = await client.callTool({ name: "website_api_search", arguments: { query: "题库" } });
    assert.equal(search.isError, undefined);
    const beforeLogin = loginRequests;
    const waiting = await client.callTool({ name: "website_api_call", arguments: { operation_id: "list_problems" } });
    assert(waiting.isError);
    assert.equal(loginRequests, beforeLogin);
    const started = await client.callTool({ name: "start_login", arguments: {} });
    const loginText = (started.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert(loginText);
    const portal = JSON.parse(loginText) as { status: string; url: string };
    assert.equal(portal.status, "waiting");
    assert.match(portal.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/);
    const challengeResponse = await fetch(new URL("challenge", portal.url));
    const challenge = await challengeResponse.json() as Record<string, unknown>;
    assert.equal(challengeResponse.status, 200);
    assert(!Object.hasOwn(challenge, "token"));
    const badOrigin = await fetch(new URL("verify", portal.url), {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example" },
      body: JSON.stringify({ clicks: [{ x: 30, y: 40 }] }),
    });
    assert.equal(badOrigin.status, 403);
    const verified = await fetch(new URL("verify", portal.url), {
      method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(portal.url).origin },
      body: JSON.stringify({ clicks: [{ x: 30, y: 40 }] }),
    });
    assert.equal(verified.status, 200);
    assert.deepEqual(await verified.json(), { success: true });
    const status = await client.callTool({ name: "login_status", arguments: {} });
    const statusText = (status.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert(statusText);
    assert.equal((JSON.parse(statusText) as { status: string }).status, "authenticated");
    const results = await Promise.all([1, 2].map(() => client.callTool({
      name: "website_api_call", arguments: { operation_id: "list_problems" },
    })));
    assert(results.every((result) => !result.isError));
    assert.equal(loginRequests, beforeLogin + 1);
    const calls = captured.filter((request) => request.url.startsWith("/api/v1/local-problem/problems?"));
    assert.equal(calls.at(-1)!.headers.authorization, "Bearer test-session-token");
    assert.equal(calls.at(-2)!.headers.authorization, "Bearer test-session-token");
    const writeResult = await client.callTool({ name: "website_api_call", arguments: {
      operation_id: "create_problem", body: { name: "MCP 测试题" },
    } });
    assert(!writeResult.isError);
    assert.deepEqual(JSON.parse(captured.at(-1)!.body.toString()), { name: "MCP 测试题" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const expired = await client.callTool({ name: "website_api_call", arguments: { operation_id: "unauthorized" } });
    assert(expired.isError);
    const afterExpiry = await client.callTool({ name: "login_status", arguments: {} });
    const expiredText = (afterExpiry.content as Array<{ type: string; text?: string }>).find((item) => item.type === "text")?.text;
    assert(expiredText);
    assert.equal((JSON.parse(expiredText) as { status: string }).status, "not_started");
  } finally {
    await client.close();
  }
});
