import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LearnHouseClient } from "./client.js";

interface CaptchaLoginOptions {
  baseUrl: string;
  username: string;
  password: string;
  client: LearnHouseClient;
  fetchImpl?: typeof fetch;
  lifetimeMs?: number;
}

interface Challenge {
  token: string;
  prompt: string[];
  image: string;
  width: number;
  height: number;
}

function page(nonce: string): string {
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>大中信奥 MCP 登录</title><style nonce="' + nonce + '">',
    'body{font:16px system-ui,-apple-system,sans-serif;background:#f4f7f8;color:#1f2937;margin:0;padding:24px}',
    'main{max-width:420px;margin:8vh auto;background:white;padding:28px;border:1px solid #dbe4e8}',
    'h1{font-size:20px;margin:0 0 12px}p{line-height:1.6}#prompt{font-weight:700;color:#087f8c}',
    '#image{width:100%;max-width:360px;display:block;cursor:crosshair;border:1px solid #cbd5e1}',
    'button{padding:9px 14px;margin:12px 8px 0 0;background:#0e7490;color:white;border:0;cursor:pointer}',
    'button:disabled{opacity:.5;cursor:default}#status{min-height:24px;color:#334155}',
    '</style></head><body><main><h1>大中信奥 MCP 登录</h1>',
    '<p>请按顺序点击图片中的汉字。验证成功后可返回 Codex 继续使用。</p>',
    '<p id="prompt">正在加载验证码…</p><img id="image" alt="汉字点选验证码">',
    '<p id="status" aria-live="polite"></p><button id="refresh" type="button">换一张</button>',
    '<button id="undo" type="button">撤销上一步</button></main>',
    '<script nonce="' + nonce + '">',
    '(function(){',
    'const prompt=document.getElementById("prompt"), image=document.getElementById("image"), status=document.getElementById("status");',
    'const refresh=document.getElementById("refresh"), undo=document.getElementById("undo");',
    'let challenge=null, clicks=[], busy=false;',
    'async function load(){busy=true;clicks=[];prompt.textContent="正在加载验证码…";status.textContent="";',
    'try{const r=await fetch("challenge",{cache:"no-store"});if(!r.ok)throw Error();challenge=await r.json();',
    'image.src=challenge.image;prompt.textContent="请依次点击："+challenge.prompt.join("、");}',
    'catch(e){challenge=null;prompt.textContent="验证码加载失败，请重试";}finally{busy=false;}}',
    'image.addEventListener("click",async function(e){if(busy||!challenge)return;const rect=image.getBoundingClientRect();',
    'clicks.push({x:Math.round((e.clientX-rect.left)*challenge.width/rect.width),y:Math.round((e.clientY-rect.top)*challenge.height/rect.height)});',
    'status.textContent="已点击 "+clicks.length+" / "+challenge.prompt.length;',
    'if(clicks.length!==challenge.prompt.length)return;busy=true;refresh.disabled=true;undo.disabled=true;',
    'try{const r=await fetch("verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clicks})});',
    'if(!r.ok)throw Error();challenge=null;status.textContent="登录成功，现在可以返回 Codex。";prompt.textContent="验证完成";}',
    'catch(e){status.textContent="验证或登录失败，请换一张重试。";clicks=[];}',
    'finally{busy=false;refresh.disabled=false;undo.disabled=false;}});',
    'refresh.addEventListener("click",load);undo.addEventListener("click",function(){if(!busy){clicks.pop();status.textContent="已点击 "+clicks.length+" / "+(challenge?challenge.prompt.length:0);}});',
    'load();})();</script></body></html>',
  ].join("\n");
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > 8192) throw new Error("请求过大");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export class CaptchaLogin {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly client: LearnHouseClient;
  private readonly fetchImpl: typeof fetch;
  private readonly lifetimeMs: number;
  private readonly nonce = randomBytes(32).toString("hex");
  private server?: Server;
  private serverPromise?: Promise<string>;
  private timer?: NodeJS.Timeout;
  private url?: string;
  private origin?: string;
  private challenge?: Challenge;
  private verifying = false;

  constructor(options: CaptchaLoginOptions) {
    const base = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("平台地址无效");
    }
    this.baseUrl = base.toString().replace(/\/$/, "");
    this.username = options.username;
    this.password = options.password;
    this.client = options.client;
    this.fetchImpl = options.fetchImpl || fetch;
    this.lifetimeMs = options.lifetimeMs ?? 5 * 60_000;
  }

  status(): { status: string; url?: string } {
    if (this.client.getAccessToken()) return { status: "authenticated" };
    if (this.url) return { status: "waiting", url: this.url };
    return { status: "not_started" };
  }

  async start(): Promise<string> {
    if (this.url) return this.url;
    if (this.serverPromise) return this.serverPromise;
    if (!this.username || !this.password) throw new Error("未配置平台账号和密码，无法启动人工验证码登录");
    this.serverPromise = new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res).catch(() => {
          if (!res.headersSent) send(res, 500, { error: "登录请求失败，请重试" });
          else res.end();
        });
      });
      this.server = server;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        this.origin = "http://127.0.0.1:" + address.port;
        this.url = this.origin + "/" + this.nonce + "/";
        this.timer = setTimeout(() => this.close(), this.lifetimeMs);
        this.timer.unref();
        resolve(this.url);
      });
    });
    try {
      return await this.serverPromise;
    } finally {
      this.serverPromise = undefined;
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.challenge = undefined;
    this.url = undefined;
    this.origin = undefined;
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const expectedHost = this.origin ? new URL(this.origin).host : "";
    if (!this.origin || req.headers.host !== expectedHost) return send(res, 403, { error: "请求来源无效" });
    const route = new URL(req.url || "/", this.origin).pathname;
    const prefix = "/" + this.nonce + "/";
    if (!route.startsWith(prefix)) return send(res, 404, { error: "页面不存在" });

    if (req.method === "GET" && route === prefix) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src data:; connect-src 'self'; script-src 'nonce-" +
          this.nonce + "'; style-src 'nonce-" + this.nonce + "'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(page(this.nonce));
      return;
    }

    if (req.method === "GET" && route === prefix + "challenge") {
      const response = await this.fetchImpl(this.baseUrl + "/api/v1/auth/captcha", {
        redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return send(res, 502, { error: "无法获取验证码" });
      const data = await response.json() as Partial<Challenge>;
      if (typeof data.token !== "string" || !data.token || typeof data.image !== "string" ||
          !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.image) ||
          data.image.length > 2_000_000 || !Array.isArray(data.prompt) ||
          !data.prompt.length || data.prompt.length > 10 ||
          !data.prompt.every((item) => typeof item === "string" && item.length <= 8) ||
          !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
          !data.width || !data.height || data.width > 5000 || data.height > 5000) {
        return send(res, 502, { error: "验证码数据无效" });
      }
      this.challenge = data as Challenge;
      return send(res, 200, { image: data.image, prompt: data.prompt, width: data.width, height: data.height });
    }

    if (req.method === "POST" && route === prefix + "verify") {
      if (req.headers.origin !== this.origin || !req.headers["content-type"]?.startsWith("application/json")) {
        return send(res, 403, { error: "请求来源无效" });
      }
      if (this.verifying || !this.challenge) return send(res, 409, { error: "请重新加载验证码" });
      const input = await readJson(req) as { clicks?: unknown };
      const clicks = input && Array.isArray(input.clicks) ? input.clicks : [];
      const challenge = this.challenge;
      if (clicks.length !== challenge.prompt.length || !clicks.every((point) =>
        point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= 0 && point.x <= challenge.width && point.y >= 0 && point.y <= challenge.height)) {
        return send(res, 400, { error: "点击坐标无效" });
      }
      this.verifying = true;
      try {
        const response = await this.fetchImpl(this.baseUrl + "/api/v1/auth/captcha/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: challenge.token, clicks }),
          redirect: "error", signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return send(res, 400, { error: "验证码验证失败" });
        const result = await response.json() as { token?: unknown };
        if (typeof result.token !== "string" || !result.token) return send(res, 502, { error: "验证码结果无效" });
        await this.client.login(this.username, this.password, result.token);
        this.challenge = undefined;
        send(res, 200, { success: true });
        setTimeout(() => this.close(), 250).unref();
      } finally {
        this.verifying = false;
      }
      return;
    }
    send(res, 404, { error: "页面不存在" });
  }
}
