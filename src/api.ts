import type { Analysis, Category, SourceVideo } from "./domain";
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
  windowControl(action: "minimize" | "maximize" | "close"): void;
  open(): Promise<Loaded | null>;
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
  cancelExport(): Promise<void>;
  onProgress(fn: (progress: Progress) => void): () => void;
  onCommand(fn: (command: string) => void): () => void;
  setDirty(dirty: boolean): void;
  close(): void;
}
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
