import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const modules = await Promise.all(
  ["config", "storage", "editor", "queue"].map((name) =>
    readFile(new URL("../src/" + name + ".js", import.meta.url), "utf8"),
  ),
);
function environment() {
  const values = new Map();
  const context = vm.createContext({
    URL,
    crypto: webcrypto,
    location: { origin: "https://bgm.tv", hostname: "bgm.tv" },
    setInterval,
    clearInterval,
    GM_getValue: (key, fallback) =>
      values.has(key) ? values.get(key) : fallback,
    GM_setValue: (key, value) => values.set(key, structuredClone(value)),
    GM_deleteValue: (key) => values.delete(key),
    GM_listValues: () => [...values.keys()],
    navigator: { locks: { request: async (name, fn) => fn() } },
  });
  vm.runInContext(
    modules.join("\n") +
      "\nglobalThis.api={CollectionEditor,normalizeJob,validateSettings,DEFAULTS,SaveQueue};",
    context,
  );
  return { context, values, ...context.api };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("默认不评分与明确评分、短评修改使用同一状态", () => {
  const { CollectionEditor } = environment(),
    editor = new CollectionEditor();
  editor.load({ interest: "", rating: "", comment: "原短评" });
  assert.equal(editor.actionLabel("anime"), "看过，不评分");
  assert.deepEqual(plain(editor.submission()), { interest: "2" });
  editor.set("rating", "8");
  editor.set("comment", "新短评");
  assert.equal(editor.actionLabel("anime"), "看过，8 分");
  assert.deepEqual(plain(editor.submission()), {
    interest: "2",
    rating: "8",
    comment: "新短评",
  });
  editor.set("rating", "keep");
  assert.deepEqual(plain(editor.submission()), {
    interest: "2",
    comment: "新短评",
  });
});
test("已有收藏只提交明确修改的字段", () => {
  const { CollectionEditor } = environment(),
    editor = new CollectionEditor();
  editor.load({ interest: "4", rating: "9", comment: "原短评" });
  assert.deepEqual(plain(editor.submission()), {});
  editor.set("comment", "");
  assert.deepEqual(plain(editor.submission()), { comment: "" });
  assert.deepEqual(plain(editor.submission("wish")), {
    interest: "1",
    comment: "",
  });
  assert.deepEqual(plain(editor.submission("save", 6)), {
    rating: "6",
    comment: "",
  });
});
test("保存想看后接受实际修改，不生成反向草稿", () => {
  const { CollectionEditor } = environment(),
    editor = new CollectionEditor();
  editor.load({ interest: "2", rating: "7", comment: "原短评" });
  editor.accept(editor.submission("wish"));
  assert.equal(editor.value.interest, "1");
  assert.equal(editor.actionLabel("book"), "想读，不评分");
  assert.deepEqual(plain(editor.changes()), {});
});
test("待保存字段和本地草稿按顺序恢复，忽略非法草稿", () => {
  const { CollectionEditor } = environment(),
    editor = new CollectionEditor();
  editor.load(
    { interest: "2", rating: "", comment: "网站" },
    { kind: "save", changes: { interest: "4", rating: "8", comment: "排队" } },
    { interest: "3", rating: "10", comment: "草稿" },
  );
  assert.deepEqual(plain(editor.submission()), {
    interest: "3",
    rating: "10",
    comment: "草稿",
  });
  editor.load({ interest: "2", rating: "6", comment: "网站" }, null, {
    interest: "99",
    rating: "0",
    comment: 42,
  });
  assert.deepEqual(plain(editor.changes()), {});
});
test("旧任务在存储边界转换，新流程没有 score 字段", () => {
  const { normalizeJob } = environment();
  const job = normalizeJob(
    { user: "test", id: "101", kind: "rate", score: 7 },
    "test",
  );
  assert.equal(job.kind, "save");
  assert.equal("score" in job, false);
  assert.deepEqual(plain(job.changes), { interest: "2", rating: "7" });
  assert.equal(
    normalizeJob({ user: "other", id: "101", kind: "rate", score: 7 }, "test"),
    null,
  );
  assert.equal(
    normalizeJob({ user: "test", id: "invalid", kind: "save" }, "test"),
    null,
  );
});
test("旧设置迁移保持自定义键位和按钮，默认左键改为想看", () => {
  const { validateSettings, DEFAULTS } = environment();
  const settings = validateSettings({
    ...plain(DEFAULTS),
    score: 7,
    bindings: {
      back: "ArrowUp",
      skip: "ArrowDown,ArrowLeft",
      rate: "r",
      remove: "",
    },
    buttons: plain(DEFAULTS.buttons).map((button) => ({
      ...button,
      action: button.action === "save" ? "rate" : button.action,
    })),
  });
  assert.equal(settings.bindings.save, "r");
  assert.equal(settings.bindings.wish, "ArrowLeft");
  assert.equal(settings.bindings.skip, "ArrowDown");
  assert.equal("score" in settings, false);
  assert.equal("rate" in settings.bindings, false);
  assert.equal(settings.buttons[1].action, "save");
  const custom = validateSettings({
    ...plain(DEFAULTS),
    bindings: { back: "ArrowLeft", skip: "ArrowDown", rate: "r", remove: "" },
  });
  assert.equal(custom.bindings.back, "ArrowLeft");
  assert.equal(custom.bindings.wish, "");
});
test("覆盖待提交任务时合并修改，保留前次短评和评分", async () => {
  const { SaveQueue, context } = environment();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  context.navigator.locks.request = async (name, fn) => {
    if (name.includes("writer:")) await gate;
    return fn();
  };
  const queue = new SaveQueue(
    "test",
    { save: async () => {} },
    () => {},
    () => {},
  );
  try {
    await queue.enqueue({ id: "101", title: "作品", type: "anime" }, "save", {
      interest: "2",
      rating: "8",
      comment: "短评",
    });
    await queue.enqueue({ id: "101", title: "作品", type: "anime" }, "save", {
      interest: "4",
    });
    const jobs = queue.all();
    assert.equal(jobs.length, 1);
    assert.deepEqual(plain(jobs[0].changes), {
      interest: "4",
      rating: "8",
      comment: "短评",
    });
    assert.equal("score" in jobs[0], false);
  } finally {
    queue.stop();
    release();
  }
});
