import * as github from "@actions/github";
import type {
  IssuesEvent,
  IssuesAssignedEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
} from "@octokit/webhooks-types";
import type { ModeName } from "../modes/registry";
import { DEFAULT_MODE } from "../modes/registry";
import { isValidMode } from "../modes/registry";

export type ParsedGitHubContext = {
  runId: string;
  eventName: string;
  eventAction?: string;
  repository: {
    owner: string;
    repo: string;
    full_name: string;
  };
  actor: string;
  payload:
    | IssuesEvent
    | IssueCommentEvent
    | PullRequestEvent
    | PullRequestReviewEvent
    | PullRequestReviewCommentEvent;
  entityNumber: number;
  isPR: boolean;
  inputs: {
    mode: ModeName;
    triggerPhrase: string;
    assigneeTrigger: string;
    labelTrigger: string;
    allowedTools: string[];
    disallowedTools: string[];
    customInstructions: string;
    directPrompt: string;
    overridePrompt: string;
    baseBranch?: string;
    branchPrefix: string;
    useStickyComment: boolean;
    additionalPermissions: Map<string, string>;
    useCommitSigning: boolean;
  };
};

export function parseGitHubContext(): ParsedGitHubContext {
  const context = github.context;

  // 初始化 repository 信息
  let repository = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    full_name: `${context.repo.owner}/${context.repo.repo}`,
  };

  // 使用 process.env.WEBHOOK_EVENT 覆盖 github.context 的上下文信息（如果有）
  if (process.env.WEBHOOK_EVENT) {
    try {
      const webhookEvent = JSON.parse(process.env.WEBHOOK_EVENT);
      if (webhookEvent && typeof webhookEvent === "object") {
        // eventName
        if (webhookEvent.event) {
          context.eventName = webhookEvent.event;
          console.log("eventName overridden from webhook event:", context.eventName);
        }
        // payload
        if (webhookEvent.payload) {
          context.payload = webhookEvent.payload;
          console.log("payload overridden from webhook event:", context.payload);
        }
        // repository
        if (
          webhookEvent.payload &&
          webhookEvent.payload.repository &&
          typeof webhookEvent.payload.repository === "object"
        ) {
          const repoObj = webhookEvent.payload.repository;
          if (repoObj.owner && repoObj.owner.login && repoObj.name) {
            repository = {
              owner: repoObj.owner.login,
              repo: repoObj.name,
              full_name: `${repoObj.owner.login}/${repoObj.name}`,
            };
            console.log("Repository overridden from webhook event:", repository);
          }
        }
        // actor
        if (
          webhookEvent.payload &&
          webhookEvent.payload.sender &&
          webhookEvent.payload.sender.login
        ) {
          context.actor = webhookEvent.payload.sender.login;
          console.log("actor overridden from webhook event:", context.actor);
        }
      }
    } catch (e) {
      console.warn("Failed to parse WEBHOOK_EVENT:", e);
    }
  }

  const modeInput = process.env.MODE ?? DEFAULT_MODE;
  if (!isValidMode(modeInput)) {
    throw new Error(`Invalid mode: ${modeInput}.`);
  }

  const commonFields = {
    runId: process.env.GITHUB_RUN_ID!,
    eventName: context.eventName,
    eventAction: context.payload.action,
    repository: repository,
    actor: context.actor,
    inputs: {
      mode: modeInput as ModeName,
      triggerPhrase: process.env.TRIGGER_PHRASE ?? "@claude",
      assigneeTrigger: process.env.ASSIGNEE_TRIGGER ?? "",
      labelTrigger: process.env.LABEL_TRIGGER ?? "",
      allowedTools: parseMultilineInput(process.env.ALLOWED_TOOLS ?? ""),
      disallowedTools: parseMultilineInput(process.env.DISALLOWED_TOOLS ?? ""),
      customInstructions: process.env.CUSTOM_INSTRUCTIONS ?? "",
      directPrompt: process.env.DIRECT_PROMPT ?? "",
      overridePrompt: process.env.OVERRIDE_PROMPT ?? "",
      baseBranch: process.env.BASE_BRANCH,
      branchPrefix: process.env.BRANCH_PREFIX ?? "claude/",
      useStickyComment: process.env.USE_STICKY_COMMENT === "true",
      additionalPermissions: parseAdditionalPermissions(
        process.env.ADDITIONAL_PERMISSIONS ?? "",
      ),
      useCommitSigning: process.env.USE_COMMIT_SIGNING === "true",
    },
  };

  switch (context.eventName) {
    case "issues": {
      console.log("=== parseGithubContext Exit from case issue ===");
      return {
        ...commonFields,
        payload: context.payload as IssuesEvent,
        entityNumber: (context.payload as IssuesEvent).issue.number,
        isPR: false,
      };
    }
    case "issue_comment": {
      console.log("=== parseGithubContext Exit from case issue_comment ===");
      return {
        ...commonFields,
        payload: context.payload as IssueCommentEvent,
        entityNumber: (context.payload as IssueCommentEvent).issue.number,
        isPR: Boolean(
          (context.payload as IssueCommentEvent).issue.pull_request,
        ),
      };
    }
    case "pull_request": {
      console.log("=== parseGithubContext Exit from case pull_request ===");
      return {
        ...commonFields,
        payload: context.payload as PullRequestEvent,
        entityNumber: (context.payload as PullRequestEvent).pull_request.number,
        isPR: true,
      };
    }
    case "pull_request_review": {
      console.log("=== parseGithubContext Exit from case pull_request_review ===");
      return {
        ...commonFields,
        payload: context.payload as PullRequestReviewEvent,
        entityNumber: (context.payload as PullRequestReviewEvent).pull_request
          .number,
        isPR: true,
      };
    }
    case "pull_request_review_comment": {
      console.log("=== parseGithubContext Exit from case pull_request_review_comment ===");
      return {
        ...commonFields,
        payload: context.payload as PullRequestReviewCommentEvent,
        entityNumber: (context.payload as PullRequestReviewCommentEvent)
          .pull_request.number,
        isPR: true,
      };
    }
    default:
      console.log("=== parseGithubContext Exit from default case ===");
      throw new Error(`Unsupported event type: ${context.eventName}`);
  }
}

export function parseMultilineInput(s: string): string[] {
  return s
    .split(/,|[\n\r]+/)
    .map((tool) => tool.replace(/#.+$/, ""))
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

export function parseAdditionalPermissions(s: string): Map<string, string> {
  const permissions = new Map<string, string>();
  if (!s || !s.trim()) {
    return permissions;
  }

  const lines = s.trim().split("\n");
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine) {
      const [key, value] = trimmedLine.split(":").map((part) => part.trim());
      if (key && value) {
        permissions.set(key, value);
      }
    }
  }
  return permissions;
}

export function isIssuesEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: IssuesEvent } {
  return context.eventName === "issues";
}

export function isIssueCommentEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: IssueCommentEvent } {
  return context.eventName === "issue_comment";
}

export function isPullRequestEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestEvent } {
  return context.eventName === "pull_request";
}

export function isPullRequestReviewEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewEvent } {
  return context.eventName === "pull_request_review";
}

export function isPullRequestReviewCommentEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestReviewCommentEvent } {
  return context.eventName === "pull_request_review_comment";
}

export function isIssuesAssignedEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: IssuesAssignedEvent } {
  return isIssuesEvent(context) && context.eventAction === "assigned";
}
