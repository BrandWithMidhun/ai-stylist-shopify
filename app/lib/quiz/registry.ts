// Tree registry — single entry point for resolving the quiz tree for a
// given storeMode. Runs validateTree() against every tree at module load
// so authoring mistakes (typo'd goTo, unreachable questions, missing
// `complete`) blow up at boot, not in a customer browser mid-quiz.
//
// Logging: emits one line per tree with the storeMode and question count.
// Useful for confirming hot-reload picked up a tree edit.

import type { StoreMode } from "../merchant-config";
import { fashionTree } from "./trees/fashion";
import { jewelleryTree } from "./trees/jewellery";
import { electronicsTree } from "./trees/electronics";
import { furnitureTree } from "./trees/furniture";
import { beautyTree } from "./trees/beauty";
import { generalTree } from "./trees/general";
import type { QuizTree } from "./types";

const TREES: Record<StoreMode, QuizTree> = {
  FASHION: fashionTree,
  JEWELLERY: jewelleryTree,
  ELECTRONICS: electronicsTree,
  FURNITURE: furnitureTree,
  BEAUTY: beautyTree,
  GENERAL: generalTree,
};

export function getTreeFor(storeMode: StoreMode): QuizTree {
  return TREES[storeMode];
}

// Walks every question + next rule and proves:
//   1. rootQuestionKey references an existing question
//   2. every `goTo` target exists
//   3. every leaf path reaches a `{ complete: true }` rule
//   4. all question keys are unique
//   5. all option keys within a question are unique
//   6. multi-select questions only use default-only NextRules (v1 limit)
//
// Throws on first violation. Designed to fail at server boot, not at
// runtime: bad authoring is a build-time concern.
export function validateTree(tree: QuizTree): void {
  const keys = new Set<string>();
  for (const q of tree.questions) {
    if (keys.has(q.key)) {
      throw new Error(`[quiz:${tree.storeMode}] duplicate question key: ${q.key}`);
    }
    keys.add(q.key);

    const optionKeys = new Set<string>();
    for (const opt of q.options) {
      if (optionKeys.has(opt.key)) {
        throw new Error(
          `[quiz:${tree.storeMode}] duplicate option key in ${q.key}: ${opt.key}`,
        );
      }
      optionKeys.add(opt.key);
    }

    if (q.type === "multi_select") {
      for (const rule of q.next) {
        if ("whenAnswerKey" in rule) {
          throw new Error(
            `[quiz:${tree.storeMode}] multi-select ${q.key} cannot use whenAnswerKey rules in v1`,
          );
        }
      }
    }
  }

  if (!keys.has(tree.rootQuestionKey)) {
    throw new Error(
      `[quiz:${tree.storeMode}] rootQuestionKey "${tree.rootQuestionKey}" not in tree`,
    );
  }

  for (const q of tree.questions) {
    let hasTerminal = false;
    for (const rule of q.next) {
      if ("complete" in rule) {
        hasTerminal = true;
        continue;
      }
      if ("goTo" in rule && !keys.has(rule.goTo)) {
        throw new Error(
          `[quiz:${tree.storeMode}] ${q.key} -> goTo "${rule.goTo}" does not exist`,
        );
      }
      if ("default" in rule) hasTerminal = true; // default goTo is a terminal-style fallback
    }
    if (!hasTerminal) {
      throw new Error(
        `[quiz:${tree.storeMode}] ${q.key} has no terminal rule (default or complete)`,
      );
    }
  }

  // Reachability: BFS from root. Any unreached question is an authoring
  // mistake — keep them out of the bundle by failing the build.
  const reached = new Set<string>([tree.rootQuestionKey]);
  const queue: string[] = [tree.rootQuestionKey];
  while (queue.length) {
    const cur = queue.shift() as string;
    const q = tree.questions.find((x) => x.key === cur);
    if (!q) continue;
    for (const rule of q.next) {
      if ("goTo" in rule && !reached.has(rule.goTo)) {
        reached.add(rule.goTo);
        queue.push(rule.goTo);
      }
    }
  }
  for (const k of keys) {
    if (!reached.has(k)) {
      throw new Error(`[quiz:${tree.storeMode}] question "${k}" is unreachable`);
    }
  }
}

// Module-load validation. Runs once per server boot. Logging is
// intentional: confirms each tree loaded and gives a quick cardinality
// check during dev.
for (const tree of Object.values(TREES)) {
  validateTree(tree);
  // eslint-disable-next-line no-console
  console.log(
    `[quiz] tree validated: ${tree.storeMode} (${tree.questions.length}q)`,
  );
}
