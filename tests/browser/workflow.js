async function runWorkflow(page, source, artifactDir) {
  const {
    context,
    tab,
    saved,
    collections,
    posts,
    gets,
    results,
    assert,
    ready,
    title,
    holdWrites,
    releaseWrites,
    rejectWrites,
    close,
  } = await createFixture(page, source, { hold: true });
  try {
    await tab.addInitScript({ content: source });
    await tab.goto("https://bgm.tv/anime/browser/?sort=rank");
    await tab.locator("#bqm-launch #launch").click();
    await ready();
    assert(
      (await tab.locator("#bqm-launch #save-collection").innerText()).includes(
        "不评分",
      ) &&
        !(await tab.locator("#bqm-launch #hint").innerText()).includes("7 分"),
      "初始按钮和快捷键提示统一显示不评分",
    );
    await tab.keyboard.press("ArrowLeft");
    await ready();
    assert((await title()) === "作品 102", "左键标记想看并立即进入下一部");
    await tab.keyboard.press("ArrowDown");
    await ready();
    assert(
      (await title()) === "作品 103" && posts.length <= 1,
      "下键跳过，不发送收藏请求",
    );
    await tab.keyboard.press("ArrowUp");
    await ready();
    await tab.locator("#bqm-launch #back").click();
    await ready();
    await tab.locator("#bqm-launch #interest").selectOption("2");
    await tab.keyboard.press("ArrowRight");
    await ready();
    assert(
      !saved.has("101") && (await title()) === "作品 102",
      "保存请求未返回时已进入下一部",
    );
    await tab.locator('#bqm-launch [data-score="9"]').click();
    await ready();
    assert(
      !saved.has("101") && (await title()) === "作品 103",
      "前一笔保存未返回时可继续给下一部 9 分",
    );
    releaseWrites();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue")
        .textContent.includes("3 部已完成"),
    );
    assert(
      saved.get("101") === "0" && saved.get("102") === "9",
      "后台队列保存未评分收藏及明确选择的分数",
    );
    assert(
      posts[0].get("interest") === "1" &&
        posts[0].get("tags") === "保留标签" &&
        posts[0].get("comment") === "保留短评" &&
        posts[0].get("privacy") === "1",
      "保留标签、短评和隐私",
    );
    for (let i = 0; i < 100 && !gets.has("/subject/111"); i++)
      await tab.waitForTimeout(50);
    assert(
      gets.has("/update/111") && gets.has("/subject/111"),
      "预加载后续 8 部且跨榜单页",
    );
    const before = gets.get("/subject/104");
    rejectWrites(true);
    await tab.keyboard.press("ArrowRight");
    await ready();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue")
        .textContent.includes("1 部需重试"),
    );
    assert(
      (await title()) === "作品 104" && !saved.has("103"),
      "保存失败保留重试项，不阻挡下一部",
    );
    assert(before === gets.get("/subject/104"), "切换预加载作品不重复请求简介");
    rejectWrites(false);
    await tab.reload();
    await tab.locator("#bqm-launch #launch").click();
    await ready();
    assert((await title()) === "作品 104", "刷新恢复进度");
    assert(
      (await tab.locator("#bqm-launch #failures .failed").count()) === 1,
      "刷新后失败任务仍可恢复",
    );
    await tab
      .locator("#bqm-launch #failures button")
      .getByText("重试", { exact: true })
      .click();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue")
        .textContent.includes("1 部已完成"),
    );
    assert(saved.get("103") === "0", "重试补交未评分收藏，不注入默认分");
    const postCount = posts.length;
    for (let i = 0; i < 100 && !gets.has("/subject/102"); i++)
      await tab.waitForTimeout(50);
    await tab.keyboard.press("ArrowUp");
    await ready();
    assert((await title()) === "作品 103", "刷新后按上键返回上一部");
    const oldCount = gets.get("/subject/102");
    await tab.keyboard.press("ArrowUp");
    await ready();
    assert(
      (await title()) === "作品 102" && gets.get("/subject/102") === oldCount,
      "前两部缓存可直接返回",
    );
    await tab.locator("#bqm-launch #rank").fill("107");
    await tab.locator("#bqm-launch #jump").click();
    await ready();
    assert((await title()) === "作品 107", "按实际 Rank 定位作品，而非页码");
    await tab.locator("#bqm-launch #title").click();
    await tab.keyboard.press("ArrowUp");
    await ready();
    assert(
      (await title()) === "作品 106" && posts.length === postCount,
      "页首上键跨回上一页末尾且不提交评分",
    );
    await tab.reload();
    await tab.locator("#bqm-launch #launch").click();
    await ready();
    assert((await title()) === "作品 106", "向上返回后的位置也会记忆");
    await tab.locator("#bqm-launch #rank").fill("110");
    await tab.keyboard.press("Enter");
    await ready();
    assert((await title()) === "作品 110", "Rank 输入支持回车并定位页内作品");
    await tab.locator("#bqm-launch #rank").fill("999");
    await tab.keyboard.press("Enter");
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("status")
        .textContent.includes("未找到 Rank"),
    );
    assert((await title()) === "作品 110", "不存在的 Rank 不改变当前位置");
    await tab.locator("#bqm-launch #rank").focus();
    const count = posts.length;
    await tab.keyboard.press("ArrowDown");
    await tab.keyboard.press("ArrowRight");
    assert(posts.length === count, "输入框内方向键不评分");
    await tab.locator("#bqm-launch #close").click();
    await tab.keyboard.press("ArrowRight");
    assert(posts.length === count, "面板关闭时方向键不评分");
    await tab.locator("#bqm-launch #launch").click();
    await ready();
    const ui = (sel) => tab.locator("#bqm-launch " + sel);
    const idle = () =>
      tab.waitForFunction(() => {
        const r = document.getElementById("bqm-launch").shadowRoot;
        return (
          r.getElementById("queue").textContent.includes("0 部待完成") &&
          !r.getElementById("jump").disabled
        );
      });
    await ui("#settings-open").click();
    await ui("#setting-wheel").selectOption("direct");
    await ui("#bind-save").fill("r");
    await ui("#button-settings .label").first().fill("不了解，跳过");
    await ui("#settings-save").click();
    assert(
      (await ui("#save-collection").innerText()).includes("不评分") &&
        (await ui("#skip").innerText()) === "不了解，跳过",
      "自定义快捷键和按钮不会引入默认评分",
    );
    await ui("#rating").selectOption("8");
    assert(
      (await ui("#save-collection").innerText()).includes("8 分") &&
        (await ui("#hint").innerText()).includes("8 分"),
      "选择评分后底部按钮和快捷键提示同步更新",
    );
    await ui("#title").click();
    await tab.keyboard.press("r");
    await ready();
    await idle();
    assert(
      saved.get("110") === "8" && (await title()) === "作品 111",
      "自定义键保存面板明确选择的评分",
    );
    await tab.keyboard.press("0");
    await ready();
    await idle();
    assert(saved.get("111") === "10", "数字 0 直接给 10 分");
    await tab.keyboard.press("Numpad6");
    await idle();
    assert(saved.get("112") === "6", "小键盘评分且榜单末尾不丢失位置");
    await ui("#remove").click();
    await ui("#modal-no").click();
    assert(saved.get("112") === "6", "取消删除不会修改收藏");
    await ui("#remove").click();
    await ui("#modal-yes").click();
    await idle();
    assert(
      !saved.has("112") && (await title()) === "作品 112",
      "面板直接删除收藏并停留当前作品",
    );
    await ui("#rank").fill("103");
    await ui("#jump").click();
    await ready();
    holdWrites();
    await ui('[data-score="9"]').click();
    await ready();
    // Wait until the save request is actually in flight, then navigate back and delete.
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue-items")
        .textContent.includes("正在保存"),
    );
    await ui("#back").click();
    await ready();
    await ui("#remove").click();
    await ui("#modal-yes").click();
    releaseWrites();
    await idle();
    assert(!saved.has("103"), "评分请求未完成时删除，最终保持未收藏");
    await ui("#settings-open").click();
    await ui("#bind-save").fill("ArrowUp");
    await ui("#settings-save").click();
    assert(
      (await ui("#settings-error").innerText()).includes("冲突"),
      "检测重复快捷键",
    );
    await ui("#settings-cancel").click();
    const wheelBefore = posts.length;
    await ui("#title").dispatchEvent("wheel", {
      deltaY: 130,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    });
    await ready();
    assert(
      (await title()) === "作品 104" && posts.length === wheelBefore,
      "滚轮向下只跳过，不提交评分",
    );
    await ui("#title").dispatchEvent("wheel", {
      deltaY: 130,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    });
    assert((await title()) === "作品 104", "滚轮惯性不会连续跳过");
    await ui("#category").selectOption("game");
    await ui("#sort").selectOption("date");
    await ui("#source-apply").click();
    await ready();
    assert(
      (await title()) === "作品 101" &&
        (await ui("#jump-label").innerText()) === "列表第 N 项",
      "游戏日期排序使用独立列表与序号跳转",
    );
    await ui("#rank").fill("3");
    await ui("#jump").click();
    await ready();
    assert((await title()) === "作品 103", "非排名排序按列表序号定位");
    await ui("#category").selectOption("anime");
    await ui("#sort").selectOption("rank");
    await ui("#source-apply").click();
    await ready();
    assert((await title()) === "作品 104", "切换列表恢复各自位置");
    await ui("#category").selectOption("comic");
    await ui("#source-apply").click();
    await ready();
    assert(
      (await ui("#source-url").inputValue()).includes("/book/browser/comic/"),
      "漫画使用书籍漫画子分类",
    );
    for (const category of ["anime", "book", "game", "music", "real"])
      for (const sort of ["rank", "trends", "collects", "date", "title"]) {
        await ui("#category").selectOption(category);
        await ui("#sort").selectOption(sort);
        await ui("#source-apply").click();
        await ready();
        assert(
          (await ui("#source-url").inputValue()).includes(
            "/" + category + "/browser/",
          ) && (await ui("#source-url").inputValue()).includes("sort=" + sort),
          "列表适配 " + category + "/" + sort,
        );
      }
    await ui("#category").selectOption("anime");
    await ui("#sort").selectOption("rank");
    await ui("#source-apply").click();
    await ready();
    await ui("#timeline-user").fill("other");
    await ui("#timeline-apply").click();
    await ready();
    assert(
      (await title()) === "作品 201" &&
        (await ui("#source-title").innerText()).includes("@other"),
      "他人时间胶囊只显示已评分动画",
    );
    assert(await ui("#jump").isHidden(), "时间胶囊不显示 Rank 跳转");
    await ui("#skip").click();
    await ready();
    assert((await title()) === "作品 204", "在看但已评分的动画也会出现");
    await ui("#skip").click();
    await ready();
    assert(
      (await title()) === "作品 203" &&
        (await ui("#position").innerText()).includes("第 3 页"),
      "跨过没有已评分动画的时间胶囊页",
    );
    await ui("#back").click();
    await ready();
    assert((await title()) === "作品 204", "时间胶囊可跨空页返回");
    await tab.reload();
    await ui("#launch").click();
    await ready();
    assert(
      (await title()) === "作品 204" &&
        (await ui("#source-title").innerText()).includes("@other"),
      "刷新后恢复他人的时间胶囊及位置",
    );
    await ui("#category").selectOption("anime");
    await ui("#sort").selectOption("rank");
    await ui("#source-apply").click();
    await ready();
    await ui("#rank").fill("105");
    await ui("#jump").click();
    await ready();
    const other = await context.newPage();
    await other.goto("https://bgm.tv/anime/browser/?sort=rank");
    await other.evaluate(source);
    await other.locator("#bqm-launch #launch").click();
    await other.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("status")
        .textContent.startsWith("准备好了"),
    );
    holdWrites();
    await ui('[data-score="5"]').click();
    await ready();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue-items")
        .textContent.includes("正在保存"),
    );
    await other.locator('#bqm-launch [data-score="9"]').click();
    releaseWrites();
    await idle();
    assert(
      saved.get("105") === "9",
      "两个标签页串行保存同一作品，最后一次评分生效",
    );
    await other.close();
    await tab.reload();
    await ui("#launch").click();
    await ready();
    assert(
      (await ui("#save-collection").innerText()).includes("不评分"),
      "刷新后默认不修改评分",
    );
    await ui("#settings-open").click();
    await ui("#settings-reset").click();
    await ui("#settings-cancel").click();
    assert(
      (await ui("#skip").innerText()) === "不了解，跳过",
      "取消恢复默认不会改动运行中的设置",
    );
    await ui("#settings-open").click();
    const backup = await tab.evaluate(() => ({
      schema: 2,
      user: "test",
      settings: JSON.parse(localStorage.getItem("bqm:v2:settings")),
      positions: [
        {
          list: "/anime/browser/?sort=rank",
          position: { page: 1, index: 1, id: "102" },
        },
      ],
    }));
    const attachBackup = async (data) =>
      tab.evaluate((data) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([JSON.stringify(data)], "backup.json", {
            type: "application/json",
          }),
        );
        document
          .getElementById("bqm-launch")
          .shadowRoot.getElementById("import-file").files = transfer.files;
      }, data);
    await attachBackup(backup);
    await ui("#import").click();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("settings-error")
        .textContent.includes("已导入"),
    );
    await ui("#settings-cancel").click();
    await ui("#retry").click();
    await ready();
    assert((await title()) === "作品 102", "导入同账号备份恢复指定作品位置");
    await ui("#settings-open").click();
    await attachBackup({ ...backup, user: "someone-else" });
    await ui("#import").click();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("settings-error")
        .textContent.includes("不匹配"),
    );
    assert(true, "拒绝其他账号备份");
    await ui("#settings-cancel").click();
    await tab.evaluate(() => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("bqm:")) localStorage.removeItem(k);
      localStorage.setItem(
        "bangumi-quick-mark-v1:test",
        JSON.stringify({ page: 2, index: 2, id: "109" }),
      );
    });
    await tab.reload();
    await ui("#launch").click();
    await ready();
    assert((await title()) === "作品 109", "自动迁移 1.x 的持久化位置");
    await tab.evaluate(() => {
      const prefix = "bqm:v2:job:" + location.hostname + ":test:";
      localStorage.setItem(
        prefix + "recover",
        JSON.stringify({
          uid: "recover",
          user: "test",
          id: "104",
          title: "作品 104",
          kind: "rate",
          score: 4,
          status: "saving",
          order: Date.now(),
          created: Date.now(),
        }),
      );
    });
    await tab.reload();
    await ui("#launch").click();
    await ready();
    await idle();
    assert(saved.get("104") === "4", "重新打开恢复未完成的保存请求");
    assert(
      (await ui("#reference").innerText()).includes("8.2 分 · 1234 人评分"),
      "展示站内平均分和评分人数",
    );
    await ui("#rank").fill("106");
    await ui("#jump").click();
    await ready();
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      collections.get("106").interest === "2" && saved.get("106") === "0",
      "未评分作品可直接标记看过，无默认分",
    );
    await ui("#back").click();
    await ready();
    await ui("#interest").selectOption("3");
    await ui("#comment").fill("第一行 & <测试>\n第二行");
    await ui("#comment").press("ArrowRight");
    await ui("#comment").press("9");
    assert(
      (await title()) === "作品 106",
      "短评输入框内数字和方向键不触发补标",
    );
    await ui("#comment").fill("第一行 & <测试>\n第二行");
    await ui("#comment").press("Control+Enter");
    await ready();
    await idle();
    assert(
      collections.get("106").interest === "3" &&
        saved.get("106") === "0" &&
        collections.get("106").comment === "第一行 & <测试>\n第二行",
      "Ctrl + Enter 同时保存状态和多行短评，不评分",
    );
    await ui("#back").click();
    await ready();
    await ui("#rating").selectOption("8");
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      saved.get("106") === "8" && collections.get("106").interest === "3",
      "评分选择器保留当前收藏状态",
    );
    await ui("#back").click();
    await ready();
    const external = {
      ...collections.get("106"),
      interest: "4",
      rating: "6",
      comment: "网站新短评",
      tags: "网站新标签",
      privacy: undefined,
    };
    collections.set("106", external);
    saved.set("106", "6");
    await ui("#interest").selectOption("5");
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      collections.get("106").interest === "5" &&
        saved.get("106") === "6" &&
        collections.get("106").comment === "网站新短评" &&
        collections.get("106").tags === "网站新标签" &&
        !collections.get("106").privacy,
      "保存前读取最新表单，保留未修改的评分、短评、标签和隐私",
    );
    await ui("#back").click();
    await ready();
    await ui("#rating").selectOption("keep");
    await ui("#comment").fill("");
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      saved.get("106") === "6" &&
        collections.get("106").comment === "" &&
        collections.get("106").interest === "5",
      "不评分保留已有分数，同时可明确清空短评",
    );
    await ui("#back").click();
    await ready();
    await ui("#interest").selectOption("1");
    await ui("#comment").fill("未提交草稿");
    await tab.reload();
    await ui("#launch").click();
    await ready();
    assert(
      (await ui("#interest").inputValue()) === "1" &&
        (await ui("#comment").inputValue()) === "未提交草稿",
      "刷新恢复未提交的状态与短评草稿",
    );
    rejectWrites(true);
    await ui("#save-collection").click();
    await ready();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue")
        .textContent.includes("1 部需重试"),
    );
    rejectWrites(false);
    await tab.reload();
    await ui("#launch").click();
    await ready();
    await ui("#failures button").getByText("重试", { exact: true }).click();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue")
        .textContent.includes("1 部已完成"),
    );
    await idle();
    assert(
      collections.get("106").interest === "1" &&
        collections.get("106").comment === "未提交草稿" &&
        saved.get("106") === "6",
      "刷新后重试恢复状态和短评，同时保留原评分",
    );
    await ui("#back").click();
    await ready();
    holdWrites();
    await ui("#comment").fill("队列中的短评");
    await ui('[data-score="7"]').click();
    await ready();
    await tab.waitForFunction(() =>
      document
        .getElementById("bqm-launch")
        .shadowRoot.getElementById("queue-items")
        .textContent.includes("正在保存"),
    );
    await ui("#back").click();
    await ready();
    await ui("#interest").selectOption("4");
    await ui("#save-collection").click();
    await ready();
    releaseWrites();
    await idle();
    assert(
      collections.get("106").interest === "4" &&
        collections.get("106").comment === "队列中的短评" &&
        saved.get("106") === "7",
      "同一作品连续编辑合并待保存字段，保留前次短评与评分",
    );
    for (const [category, labels] of [
      ["book", ["想读", "读过", "在读"]],
      ["game", ["想玩", "玩过", "在玩"]],
      ["music", ["想听", "听过", "在听"]],
      ["real", ["想看", "看过", "在看"]],
    ]) {
      await ui("#category").selectOption(category);
      await ui("#source-apply").click();
      await ready();
      const actual = await ui("#interest option").allTextContents();
      assert(
        labels.every((label) => actual.includes(label)),
        "收藏状态用词适配 " + category,
      );
    }
    await ui("#category").selectOption("anime");
    await ui("#source-apply").click();
    await ready();
    await ui("#rank").fill("108");
    await ui("#jump").click();
    await ready();
    assert(
      (await ui("#rating option").count()) === 11 &&
        (await ui("#rating").inputValue()) === "keep",
      "不评分与保留原评分合并为唯一选项",
    );
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      collections.get("108").interest === "2" && saved.get("108") === "0",
      "底部主按钮默认只标记看过，不强制评分",
    );
    await ui("#back").click();
    await ready();
    await ui("#interest").selectOption("4");
    await ui("#title").click();
    await tab.keyboard.press("ArrowLeft");
    await ready();
    await idle();
    assert(
      collections.get("108").interest === "1" && saved.get("108") === "0",
      "左键覆盖所选状态为想看，不注入分数",
    );
    await ui("#back").click();
    await ready();
    assert(
      (await ui("#interest").inputValue()) === "1" &&
        (await ui("#comment").inputValue()) === "保留短评",
      "左键保存后返回显示实际状态，无残留反向草稿",
    );
    await ui("#rating").selectOption("9");
    await ui("#rating").selectOption("keep");
    assert(
      (await ui("#save-collection").innerText()).includes("不评分"),
      "切换回不评分后按钮不再显示所选分数",
    );
    await ui("#interest").selectOption("3");
    await ui("#save-collection").click();
    await ready();
    await idle();
    assert(
      saved.get("108") === "0" && collections.get("108").interest === "3",
      "取消选择分数后保存仅修改状态",
    );
    await ui("#rank").fill("106");
    await ui("#jump").click();
    await ready();
    await ui("#interest").selectOption("3");
    await ui("#title").click();
    await tab.keyboard.press("ArrowRight");
    await ready();
    await idle();
    assert(
      collections.get("106").interest === "3" && saved.get("106") === "7",
      "已有评分作品使用保存快捷键保留评分",
    );
    const legacySettings = {
      ...backup.settings,
      score: 7,
      bindings: {
        back: "ArrowUp",
        skip: "ArrowDown,ArrowLeft",
        rate: "ArrowRight",
        remove: "",
      },
    };
    await tab.evaluate(
      (value) => localStorage.setItem("bqm:v2:settings", JSON.stringify(value)),
      legacySettings,
    );
    await tab.reload();
    await ui("#launch").click();
    await ready();
    assert(
      (await ui("#hint").innerText()).includes("← 想看") &&
        (await ui("#save-collection").innerText()).includes("不评分"),
      "旧默认快捷键迁移为左键想看，旧默认分不自动套用",
    );
    await ui("#title").click();
    await tab.keyboard.press("ArrowLeft");
    await ready();
    await idle();
    assert(
      collections.get("107").interest === "1" && saved.get("107") === "0",
      "迁移后左键正确标记想看",
    );
    await tab.setViewportSize({ width: 1280, height: 1100 });
    await ui("#panel").screenshot({ path: artifactDir + "/panel.png" });
    await ui("#settings-open").click();
    await ui("#panel").screenshot({ path: artifactDir + "/settings.png" });
  } catch (error) {
    throw Error(
      results.join("\n") +
        "\n" +
        error.message +
        "\n" +
        (await tab.locator("#bqm-launch #panel").innerText()),
    );
  } finally {
    await close();
  }
  return results;
}
