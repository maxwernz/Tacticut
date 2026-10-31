import type { Analysis, Category, SourceVideo } from "./domain";
import type { UpdatesApi } from "./updates";
export type ProjectEntry = {
  path: string;
  title: string;
  clips: number;
  videos: number;
  lastOpened: string;
  missing: boolean;
};
export type Media = {
  url: string;
  path: string;
  duration_ms: number;
  fps: number;
  width: number;
  height: number;
};
export type Loaded = {
  analysis: Analysis;
  path: string | null;
  stamp: string | null;
  legacyPath?: string | null;
};
export type ExportOptions = {
  language?: "en" | "de";
  annotations?: boolean;
  replay?: boolean;
  replaySpeed?: 0.25 | 0.5;
  handball?: boolean;
  ids: string[];
  title: boolean;
  categories: boolean;
  notes: boolean;
  numbers: boolean;
  audio: boolean;
  encoder: "auto" | "software";
  height: number;
};
export type Progress = { percent: number; message: string };
export interface DesktopAPI {
  platform: string;
  language?: "de" | "en";
  setLanguage?(language: "de" | "en"): Promise<void>;
  windowControl(action: "minimize" | "maximize" | "close"): void;
  open(): Promise<Loaded | null>;
  projects?(): Promise<ProjectEntry[]>;
  browseProjects?(): Promise<ProjectEntry[]>;
  openProject?(path: string): Promise<Loaded>;
  createCollection?(paths: string[], title: string): Promise<Loaded>;
  forgetProject?(path: string): Promise<void>;
  /** The Analysis last opened from Finder or Explorer, once; null if there is none. */
  openPending(): Promise<Loaded | null>;
  save(data: Loaded, saveAs: boolean): Promise<Loaded | null>;
  addVideos(): Promise<SourceVideo[]>;
  importPaths(paths: string[]): Promise<SourceVideo[]>;
  filePaths(files: File[]): string[];
  media(
    source: SourceVideo,
    documentPath: string | null,
    proxy?: boolean,
  ): Promise<Media>;
  relink(source: SourceVideo): Promise<SourceVideo | null>;
  recovery(data: Loaded | null): Promise<void>;
  restore(): Promise<Loaded | null>;
  template(categories?: Category[]): Promise<Category[]>;
  export(data: Loaded, options: ExportOptions): Promise<string | null>;
  playerExports?(
    data: Loaded,
    options: ExportOptions,
  ): Promise<{
    directory: string;
    completed: number;
    total: number;
    cancelled: boolean;
  } | null>;
  cancelExport(): Promise<void>;
  report?(
    data: Loaded,
    ids: string[],
    format: "pdf" | "csv",
  ): Promise<string | null>;
  onProgress(fn: (progress: Progress) => void): () => void;
  onCommand(fn: (command: string) => void): () => void;
  setDirty(dirty: boolean): void;
  close(): void;
  /** Absent in test doubles of the bridge. */
  updates?: UpdatesApi;
}
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
