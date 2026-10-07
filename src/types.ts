/**
 * LearnHouse API Client Configuration
 */
export interface LearnHouseConfig {
  baseUrl: string;
  orgId: number;
  orgSlug?: string;
  accessToken?: string;
}

/**
 * Activity types supported by LearnHouse
 */
export enum ActivityType {
  TYPE_DYNAMIC = "TYPE_DYNAMIC",
  TYPE_VIDEO = "TYPE_VIDEO",
  TYPE_DOCUMENT = "TYPE_DOCUMENT",
  TYPE_ASSIGNMENT = "TYPE_ASSIGNMENT",
  TYPE_CUSTOM = "TYPE_CUSTOM",
}

export enum ActivitySubType {
  SUBTYPE_DYNAMIC_PAGE = "SUBTYPE_DYNAMIC_PAGE",
  SUBTYPE_VIDEO_YOUTUBE = "SUBTYPE_VIDEO_YOUTUBE",
  SUBTYPE_VIDEO_HOSTED = "SUBTYPE_VIDEO_HOSTED",
  SUBTYPE_DOCUMENT_PDF = "SUBTYPE_DOCUMENT_PDF",
  SUBTYPE_DOCUMENT_DOC = "SUBTYPE_DOCUMENT_DOC",
  SUBTYPE_ASSIGNMENT_ANY = "SUBTYPE_ASSIGNMENT_ANY",
  SUBTYPE_CUSTOM = "SUBTYPE_CUSTOM",
}

/**
 * TipTap content node types
 */
export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
}

export interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

/**
 * User types
 */
export interface User {
  id: number;
  user_uuid: string;
  email: string;
  username: string;
  first_name?: string;
  last_name?: string;
  avatar_image?: string;
  creation_date: string;
  update_date: string;
}

export interface LoginResponse {
  user: User;
  tokens: {
    access_token: string;
    refresh_token: string;
  };
}

/**
 * Organization types
 */
export interface Organization {
  id: number;
  org_uuid: string;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  creation_date: string;
  update_date: string;
}

/**
 * Course types
 */
export interface Course {
  id: number;
  course_uuid: string;
  name: string;
  description: string;
  about?: string;
  public: boolean;
  org_id: number;
  thumbnail_image?: string;
  thumbnail_video?: string;
  thumbnail_type: "IMAGE" | "VIDEO";
  learnings?: string;
  tags?: string;
  creation_date: string;
  update_date: string;
}

export interface CourseCreate {
  name: string;
  description: string;
  public?: boolean;
  about?: string;
  learnings?: string[];
  tags?: string[];
}

export interface CourseUpdate {
  name?: string;
  description?: string;
  public?: boolean;
  about?: string;
  learnings?: string;
  tags?: string;
  thumbnail_image?: string;
  thumbnail_type?: "IMAGE" | "VIDEO";
}

export interface FullCourse extends Course {
  chapters: Chapter[];
}

/**
 * Chapter types
 */
export interface Chapter {
  id: number;
  chapter_uuid: string;
  name: string;
  description?: string;
  org_id: number;
  course_id: number;
  activities: Activity[];
  creation_date: string;
  update_date: string;
}

export interface ChapterCreate {
  name: string;
  description?: string;
  org_id: number;
  course_id: number;
}

export interface ChapterUpdate {
  name?: string;
  description?: string;
}

/**
 * Activity types
 */
export interface Activity {
  id: number;
  activity_uuid: string;
  name: string;
  activity_type: ActivityType;
  activity_sub_type: ActivitySubType;
  content: TipTapDocument | Record<string, unknown>;
  details?: Record<string, unknown>;
  published: boolean;
  org_id: number;
  course_id: number;
  creation_date: string;
  update_date: string;
}

export interface ActivityCreate {
  name: string;
  chapter_id: number;
  activity_type?: ActivityType;
  activity_sub_type?: ActivitySubType;
  content?: TipTapDocument | Record<string, unknown>;
  published?: boolean;
  details?: Record<string, unknown>;
}

export interface ActivityUpdate {
  name?: string;
  content?: TipTapDocument | Record<string, unknown>;
  activity_type?: ActivityType;
  activity_sub_type?: ActivitySubType;
  published?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Collection types
 */
export interface Collection {
  id: number;
  collection_uuid: string;
  name: string;
  description?: string;
  org_id: number;
  courses: Course[];
  creation_date: string;
  update_date: string;
}

export interface CollectionCreate {
  name: string;
  description?: string;
  org_id: number;
  courses?: number[];
  public?: boolean;
}

/**
 * Trail/Progress types
 */
export interface TrailProgress {
  course_uuid: string;
  completion_percentage: number;
  completed_activities: number;
  total_activities: number;
}

export interface ActivityStatus {
  activity_uuid: string;
  completed: boolean;
}

/**
 * Search types
 */
export interface SearchResult {
  courses?: Course[];
  users?: User[];
  collections?: Collection[];
}

/**
 * API Error
 */
export interface ApiError {
  detail: string;
  status?: number;
}
