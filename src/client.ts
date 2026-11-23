/**
 * LearnHouse API Client
 * 
 * A TypeScript client for interacting with the LearnHouse LMS API.
 */

import {
  LearnHouseConfig,
  LoginResponse,
  User,
  Organization,
  Course,
  CourseCreate,
  CourseUpdate,
  FullCourse,
  Chapter,
  ChapterCreate,
  ChapterUpdate,
  Activity,
  ActivityCreate,
  ActivityUpdate,
  Collection,
  CollectionCreate,
  TrailProgress,
  ActivityStatus,
  SearchResult,
  ApiError,
} from "./types.js";

export class LearnHouseClient {
  private config: LearnHouseConfig;
  private accessToken?: string;
  private refreshToken?: string;
  private accessExpiry?: number;
  private refreshPromise?: Promise<string | undefined>;

  constructor(config: LearnHouseConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ""),
    };
    this.accessToken = config.accessToken;
  }

  // ============================================================
  // HTTP Helpers
  // ============================================================

  private async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      formData?: FormData;
      query?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}/api/v1${path}`);
    
    // Add query parameters
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {};
    
    const accessToken = await this.getValidAccessToken();
    if (accessToken) {
      headers["Authorization"] = "Bearer " + accessToken;
    }

    let body: string | FormData | undefined;
    
    if (options.formData) {
      body = options.formData;
      // Don't set Content-Type for FormData - browser will set it with boundary
    } else if (options.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      if (response.status === 401 && accessToken) this.clearSession(accessToken);
      const error = await response.json().catch(() => ({
        detail: `HTTP ${response.status}: ${response.statusText}`,
      })) as ApiError;
      throw new Error(error.detail || `Request failed: ${response.status}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  private get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  private post<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  private put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private postForm<T>(path: string, formData: FormData, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("POST", path, { formData, query });
  }

  private putForm<T>(path: string, formData: FormData, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("PUT", path, { formData, query });
  }

  // ============================================================
  // Authentication
  // ============================================================

  /**
   * 只接受用户完成点选验证后由平台签发的验证码令牌。
   */
  async login(email: string, password: string, verifiedCaptchaToken?: string): Promise<LoginResponse> {
    if (!verifiedCaptchaToken) {
      throw new Error("请先完成人工点选验证码，再使用验证成功令牌登录");
    }
    const formData = new URLSearchParams();
    formData.set("username", email);
    formData.set("password", password);
    formData.set("captcha_token", verifiedCaptchaToken);

    const response = await fetch(this.config.baseUrl + "/api/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
      body: formData.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error("平台登录失败（HTTP " + response.status + "）");
    }
    const result = await response.json() as LoginResponse;
    if (!result.tokens?.access_token || !result.tokens?.refresh_token) {
      throw new Error("平台返回的登录会话不完整");
    }
    this.accessToken = result.tokens.access_token;
    this.refreshToken = result.tokens.refresh_token;
    this.accessExpiry = result.tokens.expiry ?? undefined;
    return result;
  }

  /**
   * 在用户会话到期前轮换令牌，并让并发请求共享同一次刷新。
   */
  async getValidAccessToken(): Promise<string | undefined> {
    if (!this.accessToken || !this.refreshToken || !this.accessExpiry ||
        Date.now() < this.accessExpiry - 60_000) {
      return this.accessToken;
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshSession().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async refreshSession(): Promise<string | undefined> {
    const refreshToken = this.refreshToken;
    if (!refreshToken) return this.accessToken;
    const response = await fetch(this.config.baseUrl + "/api/v1/auth/refresh", {
      headers: { Cookie: "LH_refresh=" + refreshToken },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (this.refreshToken !== refreshToken) return this.accessToken;
    if (response.status === 401 || response.status === 403) {
      this.clearSession();
      return undefined;
    }
    if (!response.ok) throw new Error("平台会话刷新失败（HTTP " + response.status + "）");
    const result = await response.json() as {
      access_token?: string; refresh_token?: string; expiry?: number | null;
    };
    if (!result.access_token || !result.refresh_token) {
      throw new Error("平台返回的刷新会话不完整");
    }
    if (this.refreshToken !== refreshToken) return this.accessToken;
    this.accessToken = result.access_token;
    this.refreshToken = result.refresh_token;
    this.accessExpiry = result.expiry ?? undefined;
    return this.accessToken;
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /**
   * Set access token manually
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
    this.refreshToken = undefined;
    this.accessExpiry = undefined;
  }

  clearSession(expectedAccessToken?: string): void {
    if (expectedAccessToken !== undefined && expectedAccessToken !== this.accessToken) return;
    this.accessToken = undefined;
    this.refreshToken = undefined;
    this.accessExpiry = undefined;
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User> {
    return this.get<User>("/users/profile");
  }

  // ============================================================
  // Organizations
  // ============================================================

  /**
   * List all organizations
   */
  async listOrganizations(): Promise<Organization[]> {
    return this.get<Organization[]>("/orgs/");
  }

  /**
   * Get organization by ID or slug
   */
  async getOrganization(orgId?: number): Promise<Organization> {
    const slug = this.config.orgSlug || "default";
    try {
      return await this.getOrganizationBySlug(slug);
    } catch {
      return this.get<Organization>(`/orgs/${orgId || this.config.orgId}`);
    }
  }

  /**
   * Get organization by slug
   */
  async getOrganizationBySlug(slug: string): Promise<Organization> {
    return this.get<Organization>(`/orgs/slug/${slug}`);
  }

  // ============================================================
  // Courses
  // ============================================================

  /**
   * List courses for the configured organization
   */
  async listCourses(page: number = 1, limit: number = 50): Promise<Course[]> {
    const slug = this.config.orgSlug || "default";
    return this.get<Course[]>(`/courses/org_slug/${slug}/page/${page}/limit/${limit}`);
  }

  /**
   * Analyze course export package (.zip)
   */
  async analyzeImportPackage(zipBuffer: Buffer, fileName: string): Promise<any> {
    const formData = new FormData();
    const blob = new Blob([zipBuffer], { type: "application/zip" });
    formData.append("zip_file", blob, fileName);
    return this.postForm<any>("/courses/import/analyze", formData, { org_id: this.config.orgId });
  }

  /**
   * Sync import courses after package analysis
   */
  async importCoursesSync(tempId: string, courseUuids: string[]): Promise<any> {
    return this.post<any>("/courses/import/sync", {
      temp_id: tempId,
      course_uuids: courseUuids,
    }, { org_id: this.config.orgId });
  }

  /**
   * Get course by UUID
   */
  async getCourse(courseUuid: string): Promise<Course> {
    return this.get<Course>(`/courses/${courseUuid}`);
  }

  /**
   * Get course by numeric ID
   */
  async getCourseById(courseId: number): Promise<Course> {
    return this.get<Course>(`/courses/id/${courseId}`);
  }

  /**
   * Get course with full metadata (chapters & activities)
   */
  async getCourseMeta(courseUuid: string, withUnpublished: boolean = false): Promise<FullCourse> {
    return this.get<FullCourse>(`/courses/${courseUuid}/meta`, {
      with_unpublished_activities: withUnpublished,
    });
  }

  /**
   * Create a new course
   */
  async createCourse(course: CourseCreate): Promise<Course> {
    const formData = new FormData();
    formData.set("name", course.name);
    formData.set("description", course.description);
    formData.set("public", String(course.public ?? true));
    formData.set("about", course.about ?? course.description);
    
    if (course.learnings) {
      formData.set("learnings", JSON.stringify(course.learnings));
    }
    if (course.tags) {
      formData.set("tags", JSON.stringify(course.tags));
    }

    return this.postForm<Course>(`/courses/`, formData, { org_id: this.config.orgId });
  }

  /**
   * Update a course
   */
  async updateCourse(courseUuid: string, updates: CourseUpdate): Promise<Course> {
    return this.put<Course>(`/courses/${courseUuid}`, updates);
  }

  /**
   * Upload a course thumbnail
   */
  async uploadCourseThumbnail(courseUuid: string, imageBuffer: Buffer, fileName: string, type: "IMAGE" | "VIDEO" = "IMAGE"): Promise<Course> {
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: "image/png" });
    formData.append("thumbnail", blob, fileName);
    formData.append("thumbnail_type", type);
    
    return this.putForm<Course>(`/courses/${courseUuid}/thumbnail`, formData);
  }

  /**
   * Delete a course
   */
  async deleteCourse(courseUuid: string): Promise<void> {
    await this.delete(`/courses/${courseUuid}`);
  }

  // ============================================================
  // Chapters
  // ============================================================

  /**
   * Get chapter by ID
   */
  async getChapter(chapterId: number): Promise<Chapter> {
    return this.get<Chapter>(`/chapters/${chapterId}`);
  }

  /**
   * List chapters for a course
   */
  async listChapters(courseId: number, page: number = 1, limit: number = 50): Promise<Chapter[]> {
    return this.get<Chapter[]>(`/chapters/course/${courseId}/page/${page}/limit/${limit}`);
  }

  /**
   * Create a new chapter
   */
  async createChapter(chapter: ChapterCreate): Promise<Chapter> {
    return this.post<Chapter>("/chapters/", chapter);
  }

  /**
   * Update a chapter
   */
  async updateChapter(chapterId: number, updates: ChapterUpdate): Promise<Chapter> {
    return this.put<Chapter>(`/chapters/${chapterId}`, updates);
  }

  /**
   * Delete a chapter
   */
  async deleteChapter(chapterId: number): Promise<void> {
    await this.delete(`/chapters/${chapterId}`);
  }

  // ============================================================
  // Activities
  // ============================================================

  /**
   * Get activity by UUID
   */
  async getActivity(activityUuid: string): Promise<Activity> {
    return this.get<Activity>(`/activities/${activityUuid}`);
  }

  /**
   * Get activity by numeric ID
   */
  async getActivityById(activityId: number): Promise<Activity> {
    return this.get<Activity>(`/activities/id/${activityId}`);
  }

  /**
   * List activities for a chapter
   */
  async listActivities(chapterId: number): Promise<Activity[]> {
    return this.get<Activity[]>(`/activities/chapter/${chapterId}`);
  }

  /**
   * Create a new activity
   */
  async createActivity(activity: ActivityCreate): Promise<Activity> {
    return this.post<Activity>("/activities/", {
      ...activity,
      activity_type: activity.activity_type ?? "TYPE_DYNAMIC",
      activity_sub_type: activity.activity_sub_type ?? "SUBTYPE_DYNAMIC_PAGE",
      content: activity.content ?? { type: "doc", content: [] },
      published: activity.published ?? false,
      details: activity.details ?? {},
    });
  }

  /**
   * Update an activity
   */
  async updateActivity(activityUuid: string, updates: ActivityUpdate): Promise<Activity> {
    return this.put<Activity>(`/activities/${activityUuid}`, updates);
  }

  /**
   * Delete an activity
   */
  async deleteActivity(activityUuid: string): Promise<void> {
    await this.delete(`/activities/${activityUuid}`);
  }

  // ============================================================
  // Collections
  // ============================================================

  /**
   * List collections for the configured organization
   */
  async listCollections(page: number = 1, limit: number = 50): Promise<Collection[]> {
    return this.get<Collection[]>(`/collections/org/${this.config.orgId}/page/${page}/limit/${limit}`);
  }

  /**
   * Get collection by UUID
   */
  async getCollection(collectionUuid: string): Promise<Collection> {
    return this.get<Collection>(`/collections/${collectionUuid}`);
  }

  /**
   * Create a new collection
   */
  async createCollection(collection: Omit<CollectionCreate, "org_id">): Promise<Collection> {
    return this.post<Collection>("/collections/", {
      ...collection,
      org_id: this.config.orgId,
      public: collection.public ?? true,
    });
  }

  /**
   * Update a collection
   */
  async updateCollection(collectionUuid: string, updates: Partial<CollectionCreate>): Promise<Collection> {
    return this.put<Collection>(`/collections/${collectionUuid}`, updates);
  }

  /**
   * Delete a collection
   */
  async deleteCollection(collectionUuid: string): Promise<void> {
    await this.delete(`/collections/${collectionUuid}`);
  }

  // ============================================================
  // Progress / Trail
  // ============================================================

  /**
   * Get progress for a course
   */
  async getCourseProgress(courseUuid: string): Promise<TrailProgress> {
    return this.get<TrailProgress>(`/trail/course/${courseUuid}/completion`);
  }

  /**
   * Get activity completion status
   */
  async getActivityStatus(activityUuid: string): Promise<ActivityStatus> {
    return this.get<ActivityStatus>(`/trail/activity/${activityUuid}/status`);
  }

  /**
   * Mark activity as complete
   */
  async markActivityComplete(activityUuid: string): Promise<{ completed: boolean }> {
    return this.post<{ completed: boolean }>(`/trail/activity/${activityUuid}/mark_complete`);
  }

  /**
   * Mark activity as incomplete
   */
  async markActivityIncomplete(activityUuid: string): Promise<{ completed: boolean }> {
    return this.post<{ completed: boolean }>(`/trail/activity/${activityUuid}/mark_incomplete`);
  }

  // ============================================================
  // Search
  // ============================================================

  /**
   * Search across courses, users, and collections
   */
  async search(orgSlug: string, query: string): Promise<SearchResult> {
    return this.get<SearchResult>(`/search/org_slug/${orgSlug}`, {
      query: query,
    });
  }

  // ============================================================
  // Health
  // ============================================================

  /**
   * Check API health
   */
  async healthCheck(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>("/health");
  }
}

// Export a factory function
export function createClient(config: LearnHouseConfig): LearnHouseClient {
  return new LearnHouseClient(config);
}
