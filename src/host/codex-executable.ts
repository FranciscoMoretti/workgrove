import { homedir } from "node:os";

export function codexExecutableCandidates(): string[] {
  const candidates = ["codex"];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      `${homedir()}/Applications/ChatGPT.app/Contents/Resources/codex`
    );
  }
  return candidates;
}
