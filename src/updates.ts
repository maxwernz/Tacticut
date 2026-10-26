/** Where an update stands, as the window shows it. */
export type UpdateState =
  | { status: "none" }
  /** `canInstall` is false when this copy cannot replace itself; `page` is where to get the build by hand. */
  | {
      status: "available";
      version: string;
      notes: string;
      page: string;
      canInstall: boolean;
    }
  | { status: "downloading"; version: string; progress: number }
  /** Downloaded and verified. It is put in place when Tacticut quits. */
  | { status: "ready"; version: string }
  | { status: "failed"; version: string; message: string; page: string };

/** What the window may ask about updates. */
export interface UpdatesApi {
  state(): Promise<UpdateState>;
  /** Download and verify the update. True once it is ready to be put in place. */
  install(): Promise<boolean>;
  /** Quit and come back as the new version. Call only once the user may leave. */
  restart(): Promise<void>;
  /** Open the page the build can be downloaded from by hand. */
  openPage(): Promise<void>;
  onChange(listener: (state: UpdateState) => void): () => void;
}

export const UPDATE_CHANNELS = {
  state: "updates:state",
  install: "updates:install",
  restart: "updates:restart",
  openPage: "updates:open-page",
  changed: "updates:changed",
} as const;
