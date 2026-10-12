async function createFixture(page, source, options = {}) {
  const context = await page.context().browser().newContext();
  const tab = await context.newPage();
  const saved = new Map(),
    collections = new Map();
  const escapeHTML = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  const posts = [];
  let rejectSave = false;
  let release;
  let gate = new Promise((resolve) => {
    release = resolve;
  });
  let hold = options.hold || false;
  const gets = new Map(),
    results = [];
  const form = (id) => {
    const value = collections.get(id) || {
      interest: saved.has(id) ? "2" : "",
      comment: "保留短评",
      tags: "保留标签",
      privacy: "1",
    };
    return `<form method="post" action="/subject/${id}/interest/update?gh=test"><input name="referer" value="subject" type="hidden">${[1, 2, 3, 4, 5].map((i) => `<input name="interest" type="radio" value="${i}" ${value.interest === String(i) ? "checked" : ""}>`).join("")}${Array.from({ length: 11 }, (_, i) => `<input name="rating" type="radio" value="${i}" ${(saved.get(id) || "0") === String(i) ? "checked" : ""}>`).join("")}<input name="tags" value="${escapeHTML(value.tags)}"><textarea name="comment">${escapeHTML(value.comment)}</textarea><input type="checkbox" name="privacy" value="1" ${value.privacy === "1" ? "checked" : ""}><input type="submit" name="update" value="保存"></form>`;
  };
  const list = (ids) =>
    `<div id="dock"><a href="/user/test">测试用户</a></div><ul id="browserItemList">${ids.map((id) => `<li><h3><a href="/subject/${id}">作品 ${id}</a></h3><span class="rank">Rank ${id}</span><p class="info">TV / 12话</p></li>`).join("")}</ul>`;
  const capsule = (entries, next) =>
    `<div id="dock"><a href="/user/test">测试用户</a></div><ul id="timelineTabs"></ul>${entries.map(([id, action, score]) => `<li class="tml_item"><span class="info_full">${action} <a data-subject-id="${id}" href="/subject/${id}">作品 ${id}</a><div class="collectInfo">${score ? `<span class="starlight stars${score}"></span>` : ""}</div><div class="card"><p class="title"><a href="/subject/${id}">作品 ${id}</a></p><p class="info">TV / 12话</p></div></span></li>`).join("")}${next ? '<a href="?type=subject&page=2">下一页 ››</a>' : ""}`;
  await context.route("**/*", async (route) => {
    const req = route.request(),
      path = req.url().replace(/^https?:\/\/[^/]+/, "");
    const url = {
      pathname: path.split("?")[0],
      searchParams: {
        get: (name) =>
          (path.match(new RegExp("[?&]" + name + "=([^&]+)")) || [])[1],
      },
    };
    if (req.method() === "POST") {
      if (!/^\/subject\/\d+\/interest\/update$/.test(url.pathname))
        throw Error("Unexpected write");
      const values = Object.fromEntries(
        req
          .postData()
          .split("&")
          .map((pair) =>
            pair
              .split("=")
              .map((v) => decodeURIComponent(v.replace(/\+/g, " "))),
          ),
      );
      const body = { get: (name) => values[name] };
      posts.push(body);
      if (hold) await gate;
      if (rejectSave) return route.fulfill({ status: 500, body: "failed" });
      const id = url.pathname.split("/")[2];
      saved.set(id, body.get("rating"));
      collections.set(id, values);
      return route.fulfill({ status: 200, body: "ok" });
    }
    let body = "";
    gets.set(path, (gets.get(path) || 0) + 1);
    if (url.pathname === "/")
      body = '<div id="dock"><a href="/user/test">测试用户</a></div>';
    else if (/\/(anime|book|game|music|real)\/browser/.test(url.pathname))
      body = list(
        Number(url.searchParams.get("page") || 1) > 2
          ? []
          : url.searchParams.get("page") === "2"
            ? ["107", "108", "109", "110", "111", "112"]
            : ["101", "102", "103", "104", "105", "106"],
      );
    else if (url.pathname === "/user/other/timeline")
      body =
        url.searchParams.get("page") === "3"
          ? capsule([["203", "看过", 7]], false)
          : url.searchParams.get("page") === "2"
            ? capsule([["202", "看过", 8]], true)
            : capsule(
                [
                  ["201", "看过", 9],
                  ["299", "看过", 6],
                  ["204", "在看", 8],
                  ["205", "看过", 0],
                ],
                true,
              );
    else if (url.pathname.startsWith("/update/"))
      body = form(url.pathname.split("/")[2]);
    else if (/\/subject\/\d+\/remove/.test(url.pathname)) {
      saved.delete(url.pathname.split("/")[2]);
      collections.delete(url.pathname.split("/")[2]);
      body = "removed";
    } else if (url.pathname.startsWith("/subject/"))
      body = `<a href="/${["202", "299"].includes(url.pathname.split("/")[2]) ? "real" : "anime"}" class="focus"></a><ul id="navMenuNeue"><li><a class="focus" href="/${["202", "299"].includes(url.pathname.split("/")[2]) ? "real" : "anime"}">分类</a></li></ul><div id="panelInterest"><div class="global_score"><span class="number" property="v:average">8.2</span><span property="v:votes">1234</span></div></div><div id="subject_summary">测试简介</div>`;
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body,
    });
  });
  const assert = (ok, msg) => {
    if (!ok) throw Error(msg);
    results.push("PASS " + msg);
  };
  const ready = () =>
    tab.waitForFunction(() => {
      const r = document.getElementById("bqm-launch")?.shadowRoot;
      return (
        r?.getElementById("status").textContent.startsWith("准备好了") &&
        !r.getElementById("jump").disabled
      );
    });
  const title = () => tab.locator("#bqm-launch #title").innerText();

  const ui = (selector) => tab.locator("#bqm-launch " + selector);
  const idle = () =>
    tab.waitForFunction(() => {
      const root = document.getElementById("bqm-launch").shadowRoot;
      return (
        root.getElementById("queue").textContent.includes("0 部待完成") &&
        !root.getElementById("jump").disabled
      );
    });
  const holdWrites = () => {
    hold = true;
    gate = new Promise((resolve) => {
      release = resolve;
    });
  };
  const releaseWrites = () => {
    hold = false;
    release();
  };
  const rejectWrites = (value) => {
    rejectSave = value;
  };
  const open = async (settings = null) => {
    if (settings)
      await tab.addInitScript(
        (value) =>
          localStorage.setItem("bqm:v2:settings", JSON.stringify(value)),
        settings,
      );
    await tab.addInitScript({ content: source });
    await tab.goto("https://bgm.tv/anime/browser/?sort=rank");
    await ui("#launch").click();
    await ready();
  };
  const close = async () => {
    releaseWrites();
    await context.close();
  };
  return {
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
    ui,
    idle,
    holdWrites,
    releaseWrites,
    rejectWrites,
    open,
    close,
  };
}
