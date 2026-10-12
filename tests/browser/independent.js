async function runIndependent(page, source) {
  const results = [];
  const scenarios = [
    [
      "默认编辑与快捷键",
      async (f) => {
        await f.open();
        f.assert(
          (await f.ui("#save-collection").count()) === 1,
          "只有一个保存入口",
        );
        f.assert(
          (await f.ui("#save-collection").innerText()) === "看过，不评分",
          "默认按钮与编辑状态一致",
        );
        await f.ui("#rating").selectOption("8");
        f.assert(
          (await f.ui("#save-collection").innerText()) === "看过，8 分",
          "评分选择同步主按钮",
        );
        await f.ui("#rating").selectOption("keep");
        await f.ui("#title").click();
        await f.tab.keyboard.press("ArrowRight");
        await f.ready();
        await f.idle();
        f.assert(
          f.collections.get("101").interest === "2" &&
            f.saved.get("101") === "0",
          "右键不评分收藏无需其他场景准备",
        );
        await f.ui("#title").click();
        await f.tab.keyboard.press("ArrowLeft");
        await f.ready();
        await f.idle();
        f.assert(
          f.collections.get("102").interest === "1" &&
            f.saved.get("102") === "0",
          "左键独立标记想看",
        );
      },
    ],
    [
      "已有收藏与草稿保护",
      async (f) => {
        f.saved.set("101", "9");
        f.collections.set("101", {
          interest: "4",
          comment: "原短评",
          tags: "原标签",
          privacy: "1",
        });
        await f.open();
        await f.ui("#comment").fill("草稿 & <内容>");
        await f.tab.reload();
        await f.ui("#launch").click();
        await f.ready();
        f.assert(
          (await f.ui("#comment").inputValue()) === "草稿 & <内容>",
          "独立场景刷新恢复草稿",
        );
        f.saved.set("101", "6");
        f.collections.set("101", {
          interest: "3",
          comment: "网站短评",
          tags: "新标签",
        });
        await f.ui("#comment").press("Control+Enter");
        await f.ready();
        await f.idle();
        f.assert(
          f.saved.get("101") === "6" &&
            f.collections.get("101").interest === "3" &&
            f.collections.get("101").tags === "新标签",
          "只改短评保护最新评分、状态和标签",
        );
        f.assert(
          f.collections.get("101").comment === "草稿 & <内容>",
          "明确修改的短评被保存",
        );
      },
    ],
    [
      "队列失败与恢复",
      async (f) => {
        await f.open();
        f.rejectWrites(true);
        await f.ui("#comment").fill("重试短评");
        await f.ui("#save-collection").click();
        await f.ready();
        await f.tab.waitForFunction(() =>
          document
            .getElementById("bqm-launch")
            .shadowRoot.getElementById("queue")
            .textContent.includes("1 部需重试"),
        );
        f.rejectWrites(false);
        await f.tab.reload();
        await f.ui("#launch").click();
        await f.ready();
        await f
          .ui("#failures button")
          .getByText("重试", { exact: true })
          .click();
        await f.tab.waitForFunction(() =>
          document
            .getElementById("bqm-launch")
            .shadowRoot.getElementById("queue")
            .textContent.includes("1 部已完成"),
        );
        f.assert(
          f.saved.get("101") === "0" &&
            f.collections.get("101").comment === "重试短评",
          "独立恢复失败任务，不注入评分",
        );
      },
    ],
    [
      "旧设置迁移",
      async (f) => {
        await f.open({
          score: 7,
          bindings: {
            back: "ArrowUp",
            skip: "ArrowDown,ArrowLeft",
            rate: "r",
            remove: "",
          },
          buttons: [
            { action: "skip", label: "跳过", visible: true },
            { action: "rate", label: "", visible: true },
            { action: "back", label: "上一部", visible: true },
            { action: "remove", label: "删除", visible: true },
          ],
        });
        f.assert(
          (await f.ui("#hint").innerText()).includes("r 看过，不评分"),
          "旧 rate 键位迁移为保存且不套用默认分",
        );
        await f.ui("#title").click();
        await f.tab.keyboard.press("r");
        await f.ready();
        await f.idle();
        f.assert(f.saved.get("101") === "0", "旧自定义保存键不会隐式评分");
        await f.ui("#title").click();
        await f.tab.keyboard.press("ArrowLeft");
        await f.ready();
        await f.idle();
        f.assert(
          f.collections.get("102").interest === "1",
          "迁移后左键标记想看",
        );
      },
    ],
  ];
  for (const [name, run] of scenarios) {
    const fixture = await createFixture(page, source);
    try {
      await run(fixture);
      results.push(...fixture.results.map((result) => name + ": " + result));
    } catch (error) {
      throw Error(
        name +
          "：" +
          error.message +
          "\n" +
          (await fixture.ui("#panel").innerText()),
      );
    } finally {
      await fixture.close();
    }
  }
  return results;
}
