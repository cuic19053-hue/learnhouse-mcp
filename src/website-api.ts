import { promises as fs } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ParameterValue = string | number | boolean;
type QueryValue = ParameterValue | ParameterValue[];

interface WebsiteApiOptions {
  baseUrl: string;
  orgId: number;
  orgUuid?: string;
  getAccessToken: () => Promise<string | undefined>;
  getOrganizationUuid?: (orgId: number) => Promise<string | undefined>;
  onUnauthorized?: (token: string) => void;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  pathItem: JsonObject;
  definition: JsonObject;
}

interface ApiCatalog {
  document: JsonObject;
  operations: ApiOperation[];
  restrictedCount: number;
  loadedAt: number;
}

export interface ApiCallArguments {
  operationId: string;
  pathParams?: Record<string, ParameterValue>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  files?: Record<string, string | string[]>;
  outputPath?: string;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const MAX_SPEC_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SEARCH_ALIASES: Record<string, string[]> = {
  题库: ["problem"],
  考试: ["exam"],
  试卷: ["exam", "paper"],
  作业: ["assignment"],
  班级: ["class"],
  学情: ["learning-profile", "analytics"],
  作品: ["showcase"],
  课程: ["course"],
  标签: ["tag"],
  上传: ["upload", "import"],
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRestrictedPath(route: string, definition: JsonObject): boolean {
  if (/\/(auth|api-tokens|noi-sso)(\/|$)|password|magic-(link|consume)/i.test(route)) {
    return true;
  }
  const parameters = Array.isArray(definition.parameters) ? definition.parameters : [];
  return parameters.some((parameter) => isObject(parameter) && parameter.in === "header");
}

function resolveReference(document: JsonObject, value: unknown): unknown {
  if (!isObject(value) || typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) {
    return value;
  }
  let current: unknown = document;
  for (const rawPart of value.$ref.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(current) || !Object.hasOwn(current, part)) return value;
    current = current[part];
  }
  return current;
}

function operationParameters(document: JsonObject, operation: ApiOperation): JsonObject[] {
  const combined = [operation.pathItem.parameters, operation.definition.parameters]
    .flatMap((value) => Array.isArray(value) ? value : []);
  const parameters = new Map<string, JsonObject>();
  for (const raw of combined) {
    const parameter = resolveReference(document, raw);
    if (isObject(parameter) && typeof parameter.name === "string" && typeof parameter.in === "string") {
      parameters.set(parameter.in + ":" + parameter.name, parameter);
    }
  }
  // 部分网站路由从原始请求读取组织信息，OpenAPI 不会列出这些参数。
  if (/^\/api\/v1\/(exam|assignments|local-problem|problem-bank|showcase|smart-lab|task-manager)(\/|$)/.test(operation.path)) {
    if (!parameters.has("query:org_id")) parameters.set("query:org_id", {
      name: "org_id", in: "query", required: false,
      description: "组织 ID；未指定时使用 MCP 当前组织。",
      schema: { type: "integer" },
    });
    if (/^\/api\/v1\/(exam|local-problem|showcase|smart-lab)(\/|$)/.test(operation.path) && !parameters.has("query:org_uuid")) {
      parameters.set("query:org_uuid", {
        name: "org_uuid", in: "query", required: false,
        description: "组织 UUID；优先使用显式值，否则尝试查询当前组织。",
        schema: { type: "string" },
      });
    }
  }
  return [...parameters.values()];
}

function referencedSchemas(document: JsonObject, root: unknown): { schemas: JsonObject; truncated: boolean } {
  const schemas: JsonObject = Object.create(null) as JsonObject;
  const queue: unknown[] = [root];
  let totalBytes = 0;
  let truncated = false;
  while (queue.length > 0) {
    const value = queue.pop();
    if (Array.isArray(value)) {
      queue.push(...value);
    } else if (isObject(value)) {
      if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
        const name = value.$ref.slice("#/components/schemas/".length).replace(/~1/g, "/").replace(/~0/g, "~");
        if (!Object.hasOwn(schemas, name)) {
          const schema = resolveReference(document, value);
          if (schema !== value) {
            const size = JSON.stringify(schema).length;
            if (Object.keys(schemas).length >= 80 || totalBytes + size > 200_000) {
              truncated = true;
            } else {
              schemas[name] = schema;
              totalBytes += size;
              queue.push(schema);
            }
          }
        }
      }
      for (const [key, child] of Object.entries(value)) if (key !== "$ref") queue.push(child);
    }
  }
  return { schemas, truncated };
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw new Error("网站响应超过大小限制");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("网站响应超过大小限制");
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function mimeType(filePath: string): string {
  const types: Record<string, string> = {
    ".zip": "application/zip", ".xml": "application/xml", ".json": "application/json",
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".txt": "text/plain", ".csv": "text/csv", ".mp4": "video/mp4",
  };
  return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export class WebsiteApi {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly apiPrefix: string;
  private readonly orgId: number;
  private readonly orgUuid?: string;
  private readonly getAccessToken: () => Promise<string | undefined>;
  private readonly getOrganizationUuid?: (orgId: number) => Promise<string | undefined>;
  private readonly onUnauthorized?: (token: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private catalog?: ApiCatalog;
  private catalogPromise?: Promise<ApiCatalog>;
  private readonly organizationUuids = new Map<number, Promise<string | undefined>>();

  constructor(options: WebsiteApiOptions) {
    const base = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("网站地址必须是没有凭据、查询参数或片段的 HTTP(S) 地址");
    }
    this.baseUrl = base.toString().replace(/\/$/, "");
    this.origin = base.origin;
    this.apiPrefix = base.pathname.replace(/\/$/, "") + "/api/v1/";
    this.orgId = options.orgId;
    this.orgUuid = options.orgUuid;
    this.getAccessToken = options.getAccessToken;
    this.getOrganizationUuid = options.getOrganizationUuid;
    this.onUnauthorized = options.onUnauthorized;
    this.fetchImpl = options.fetchImpl || fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async loadCatalog(): Promise<ApiCatalog> {
    if (this.catalog && Date.now() - this.catalog.loadedAt < this.cacheTtlMs) return this.catalog;
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      try {
        const response = await this.fetchImpl(this.baseUrl + "/api/v1/openapi.json", {
          redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) throw new Error("接口目录请求失败 HTTP " + response.status);
        const document: unknown = JSON.parse((await readLimited(response, MAX_SPEC_BYTES)).toString("utf8"));
        if (!isObject(document) || !isObject(document.paths)) throw new Error("网站接口目录格式无效");
        const operations: ApiOperation[] = [];
        const ids = new Set<string>();
        let restrictedCount = 0;
        for (const [route, rawItem] of Object.entries(document.paths)) {
          if (!route.startsWith("/api/v1/") || route.includes("?") || route.includes("#") || !isObject(rawItem)) continue;
          for (const [method, definition] of Object.entries(rawItem)) {
            if (!HTTP_METHODS.has(method) || !isObject(definition) || typeof definition.operationId !== "string") continue;
            if (isRestrictedPath(route, definition) || isRestrictedPath(route, rawItem)) {
              restrictedCount++;
              continue;
            }
            if (ids.has(definition.operationId)) throw new Error("网站接口目录包含重复操作标识");
            ids.add(definition.operationId);
            operations.push({
              id: definition.operationId,
              method: method.toUpperCase() as HttpMethod,
              path: route,
              summary: typeof definition.summary === "string" ? definition.summary : "",
              tags: Array.isArray(definition.tags) ? definition.tags.filter((tag): tag is string => typeof tag === "string") : [],
              pathItem: rawItem,
              definition,
            });
          }
        }
        if (!operations.length) throw new Error("网站接口目录没有可用操作");
        const catalog = { document, operations, restrictedCount, loadedAt: Date.now() };
        this.catalog = catalog;
        return catalog;
      } catch (error) {
        if (this.catalog) return this.catalog;
        throw error;
      } finally {
        this.catalogPromise = undefined;
      }
    })();
    return this.catalogPromise;
  }

  async search(options: { query?: string; method?: HttpMethod; page?: number; pageSize?: number }): Promise<JsonObject> {
    const catalog = await this.loadCatalog();
    const query = options.query?.trim().toLowerCase() || "";
    const terms = query ? [query, ...(SEARCH_ALIASES[query] || [])] : [];
    const filtered = catalog.operations.filter((operation) => {
      if (options.method && operation.method !== options.method) return false;
      if (!terms.length) return true;
      const text = [operation.id, operation.path, operation.summary, ...operation.tags].join(" ").toLowerCase();
      return terms.some((term) => text.includes(term));
    });
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    return {
      available_operations: catalog.operations.length,
      restricted_operations: catalog.restrictedCount,
      total: filtered.length, page, page_size: pageSize,
      results: filtered.slice((page - 1) * pageSize, page * pageSize).map((operation) => ({
        operation_id: operation.id, method: operation.method, path: operation.path,
        summary: operation.summary, tags: operation.tags,
      })),
    };
  }

  private async findOperation(id: string): Promise<{ catalog: ApiCatalog; operation: ApiOperation }> {
    const catalog = await this.loadCatalog();
    const operation = catalog.operations.find((item) => item.id === id);
    if (!operation) throw new Error("网站接口不存在或不允许通用调用：" + id);
    return { catalog, operation };
  }

  async describe(operationId: string): Promise<JsonObject> {
    const { catalog, operation } = await this.findOperation(operationId);
    const parameters = operationParameters(catalog.document, operation);
    const requestBody = resolveReference(catalog.document, operation.definition.requestBody);
    const { schemas, truncated } = referencedSchemas(catalog.document, { parameters, requestBody });
    return {
      operation_id: operation.id, method: operation.method, path: operation.path,
      summary: operation.summary, description: operation.definition.description,
      tags: operation.tags, parameters, request_body: requestBody,
      referenced_schemas: schemas, schemas_truncated: truncated,
    };
  }

  async call(args: ApiCallArguments): Promise<JsonObject> {
    const { catalog, operation } = await this.findOperation(args.operationId);
    const parameters = operationParameters(catalog.document, operation);
    const pathParams = args.pathParams || {};
    const query = { ...(args.query || {}) };
    const expectedPathNames = new Set(parameters.filter((p) => p.in === "path").map((p) => p.name as string));
    for (const name of Object.keys(pathParams)) {
      if (!expectedPathNames.has(name)) throw new Error("未知路径参数：" + name);
    }
    const route = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const value = pathParams[name];
      if (value === undefined || value === null || String(value) === "") throw new Error("缺少路径参数：" + name);
      const text = String(value);
      if (text.includes("\0") || text.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) {
        throw new Error("路径参数无效：" + name);
      }
      return encodeURIComponent(text);
    });
    const url = new URL(this.baseUrl + route);
    if (url.origin !== this.origin || !url.pathname.startsWith(this.apiPrefix)) throw new Error("网站接口地址无效");
    const queryParameters = parameters.filter((parameter) => parameter.in === "query");
    const allowedQuery = new Set(queryParameters.map((parameter) => parameter.name as string));
    for (const name of Object.keys(query)) if (!allowedQuery.has(name)) throw new Error("未知查询参数：" + name);
    if (allowedQuery.has("org_id") && query.org_id === undefined) {
      query.org_id = pathParams.org_id ?? this.orgId;
    }
    if (allowedQuery.has("org_id") && query.org_id !== undefined) {
      const orgId = query.org_id;
      const parsed = typeof orgId === "number" ? orgId :
        typeof orgId === "string" && /^\d+$/.test(orgId) ? Number(orgId) : NaN;
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("组织 ID 必须是正整数");
    }
    if (allowedQuery.has("org_uuid") && query.org_uuid !== undefined &&
        (typeof query.org_uuid !== "string" || !query.org_uuid.trim())) {
      throw new Error("组织 UUID 必须是非空字符串");
    }
    if (allowedQuery.has("org_uuid") && query.org_uuid === undefined) {
      const targetOrgId = typeof query.org_id === "number" || typeof query.org_id === "string"
        ? Number(query.org_id) : this.orgId;
      if (targetOrgId === this.orgId && this.orgUuid) {
        query.org_uuid = this.orgUuid;
      } else if (Number.isInteger(targetOrgId) && this.getOrganizationUuid) {
        if (!this.organizationUuids.has(targetOrgId)) {
          const lookup = this.getOrganizationUuid(targetOrgId).then((value) => {
            if (!value) this.organizationUuids.delete(targetOrgId);
            return value;
          }).catch(() => {
            this.organizationUuids.delete(targetOrgId);
            return undefined;
          });
          this.organizationUuids.set(targetOrgId, lookup);
        }
        const orgUuid = await this.organizationUuids.get(targetOrgId);
        if (orgUuid) query.org_uuid = orgUuid;
      }
    }
    for (const parameter of queryParameters) {
      const name = parameter.name as string;
      const value = query[name];
      if (value === undefined || value === null) {
        if (parameter.required === true) throw new Error("缺少查询参数：" + name);
        continue;
      }
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
    }

    const rawBody = resolveReference(catalog.document, operation.definition.requestBody);
    const bodyDefinition = isObject(rawBody) ? rawBody : undefined;
    const content = bodyDefinition && isObject(bodyDefinition.content) ? bodyDefinition.content : {};
    const hasFiles = args.files && Object.keys(args.files).length > 0;
    const hasBody = args.body !== undefined;
    if (bodyDefinition?.required === true && !hasBody && !hasFiles) throw new Error("此接口需要请求内容");
    if ((hasBody || hasFiles) && !bodyDefinition) throw new Error("此接口没有声明请求内容");
    const headers: Record<string, string> = {};
    let body: string | FormData | undefined;
    if (hasFiles && !Object.hasOwn(content, "multipart/form-data")) throw new Error("此接口不支持文件上传");
    if (Object.hasOwn(content, "multipart/form-data") && (hasBody || hasFiles)) {
      if (hasBody && !isObject(args.body)) throw new Error("文件表单内容必须是对象");
      const form = new FormData();
      for (const [name, raw] of Object.entries(isObject(args.body) ? args.body : {})) {
        for (const value of Array.isArray(raw) ? raw : [raw]) {
          if (value !== undefined && value !== null) form.append(name, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      }
      for (const [name, rawPaths] of Object.entries(args.files || {})) {
        for (const filePath of Array.isArray(rawPaths) ? rawPaths : [rawPaths]) {
          if (!path.isAbsolute(filePath)) throw new Error("上传文件必须使用本地绝对路径");
          const stat = await fs.stat(filePath);
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("上传文件无效或超过 50 MB 限制");
          const data = await fs.readFile(filePath);
          form.append(name, new Blob([new Uint8Array(data)], { type: mimeType(filePath) }), path.basename(filePath));
        }
      }
      body = form;
    } else if (hasBody && Object.hasOwn(content, "application/json")) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.body);
    } else if (hasBody && Object.hasOwn(content, "application/x-www-form-urlencoded")) {
      if (!isObject(args.body)) throw new Error("表单内容必须是对象");
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(args.body)) if (value !== undefined && value !== null) form.append(name, String(value));
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = form.toString();
    } else if (hasBody || hasFiles) {
      throw new Error("暂不支持此接口的请求内容格式");
    }

    if (args.outputPath && !path.isAbsolute(args.outputPath)) throw new Error("保存文件必须使用本地绝对路径");
    const token = await this.getAccessToken();
    if (token) headers.Authorization = "Bearer " + token;
    // 先占用目标文件，避免请求已产生线上副作用后才发现本地文件冲突。
    const outputFile = args.outputPath ? await fs.open(args.outputPath, "wx") : undefined;
    let saved = false;
    try {
      const response = await this.fetchImpl(url, {
        method: operation.method, headers, body, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 401 && token) this.onUnauthorized?.(token);
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        await response.body?.cancel();
        throw new Error("此接口返回实时事件流，请使用普通结果查询接口");
      }
      const bytes = await readLimited(response, outputFile && response.ok ? MAX_FILE_BYTES : MAX_RESPONSE_BYTES);
      if (!response.ok) throw new Error("网站请求失败 HTTP " + response.status + ": " + bytes.toString("utf8").slice(0, 1200));
      if (outputFile) {
        await outputFile.writeFile(bytes);
        saved = true;
        return { status: response.status, saved_to: args.outputPath, bytes: bytes.length, content_type: contentType };
      }
      if (!bytes.length) return { status: response.status, data: null };
      if (contentType.includes("json")) {
        const text = bytes.toString("utf8");
        try { return { status: response.status, data: JSON.parse(text) as unknown }; }
        catch { return { status: response.status, data: text }; }
      }
      if (contentType.startsWith("text/")) return { status: response.status, data: bytes.toString("utf8") };
      throw new Error("此接口返回文件，请提供 output_path 保存到本机");
    } finally {
      if (outputFile) {
        await outputFile.close();
        if (!saved && args.outputPath) await fs.unlink(args.outputPath).catch(() => undefined);
      }
    }
  }
}
