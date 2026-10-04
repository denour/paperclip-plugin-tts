import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { instanceConfigSchema } from "./lib/config.ts";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-plugin-tts",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Text to Speech",
  description:
    "Adds a play button to issue descriptions and comments. Reads them aloud with the browser's built-in voices, any OpenAI-compatible TTS server, or ElevenLabs.",
  author: "paperclip-plugin-tts contributors",
  categories: ["ui"],
  capabilities: [
    "issues.read",
    "issue.comments.read",
    "http.outbound",
    "secrets.read-ref",
    "ui.detailTab.register",
    "ui.commentAnnotation.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: instanceConfigSchema as unknown as PaperclipPluginManifestV1["instanceConfigSchema"],
  ui: {
    slots: [
      {
        type: "taskDetailView",
        id: "issue-listen",
        displayName: "Listen",
        exportName: "IssueListen",
        entityTypes: ["issue"],
      },
      {
        type: "commentAnnotation",
        id: "comment-listen",
        displayName: "Listen",
        exportName: "CommentListen",
        entityTypes: ["comment"],
      },
    ],
  },
};

export default manifest;
