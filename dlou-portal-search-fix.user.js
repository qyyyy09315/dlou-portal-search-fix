// ==UserScript==
// @name         大连海洋大学门户搜索防刷新
// @namespace    https://my.dlou.edu.cn/frontend/center_portal_dlou/
// @version      1.0.0
// @description  单独处理门户搜索鉴权失败，保留搜索词并提示重新登录，避免搜索调用公共登录跳转逻辑。
// @author       CanCanNeed
// @license      MIT
// @homepageURL  https://github.com/qyyyy09315/dlou-portal-search-fix
// @supportURL   https://github.com/qyyyy09315/dlou-portal-search-fix/issues
// @match        https://my.dlou.edu.cn/frontend/center_portal_dlou/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  var KEY = "dlou_portal_search_keep";
  var SELECTOR = '#homeBox input.el-input__inner[placeholder="综合内容"]';
  var patched = new WeakSet();
  function save(value) {
    try {
      if (value) sessionStorage.setItem(KEY, value);
      else sessionStorage.removeItem(KEY);
    } catch (_) {}
  }
  function read(key) {
    try { return sessionStorage.getItem(key) || ""; }
    catch (_) { return ""; }
  }
  function status(message) {
    var box = document.getElementById("dlou-search-fix-status");
    if (!box) {
      box = document.createElement("div");
      box.id = "dlou-search-fix-status";
      box.setAttribute("role", "status");
      box.style.cssText = "position:fixed;right:16px;bottom:16px;max-width:420px;z-index:2147483647;padding:10px 14px;background:#1f2d3d;color:white;border-radius:5px;font-size:14px;line-height:1.6";
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.hidden = !message;
  }
  function patch(vm) {
    if (patched.has(vm)) return;
    // mounted 创建的 debounce 闭包仍引用原方法，需要一并替换。
    if (typeof vm.debounceGetSearchData.cancel === "function") vm.debounceGetSearchData.cancel();
    var timer, controller;
    var generation = 0;
    function invalidate() {
      generation += 1;
      if (controller) controller.abort();
      vm.searchLoading = false;
    }
    vm.getSearchData = async function () {
      clearTimeout(timer);
      invalidate();
      var current = generation;
      var term = String(vm.search || "");
      save(term);
      if (!term) { vm.searchList = []; status(""); return; }
      var token = read("center_portal_token");
      if (!token) {
        status("门户搜索缺少登录凭据，搜索词已保留。请使用门户右上角菜单退出后重新登录。");
        return;
      }
      if (!vm.apiSearch) { status("门户搜索配置尚未加载，请稍后再试。"); return; }
      controller = new AbortController();
      var signal = controller.signal;
      vm.searchLoading = true;
      var results = [];
      try {
        for (var key of Object.keys(vm.apiSearch)) {
          var item = vm.apiSearch[key];
          var url = new URL(item.apiFetch, location.href);
          // 只向两个确切的门户 HTTPS 域名发送原有认证头。
          if (url.protocol !== "https:" || ["my.dlou.edu.cn", "portal.dlou.edu.cn"].indexOf(url.hostname) < 0 || url.port || url.username || url.password) {
            throw new Error("搜索接口不在允许的门户地址范围内");
          }
          url.searchParams.set("search", term);
          var response = await fetch(url.href, {
            method: "GET", credentials: "same-origin", redirect: "error",
            headers: { Authorization: token, Accept: "application/json" }, signal: signal
          });
          if (current !== generation) return;
          if (response.status === 401 || response.status === 403) {
            // 该可选分类可能不对当前账号开放，静默跳过并继续其他分类。
            if (key === "person" || item.display === "person" || url.searchParams.get("module") === "通讯录") continue;
            if (results.length) vm.searchList = results;
            status("搜索分类「" + String(item.display || key) + "」鉴权失败（" + response.status + "），搜索词已保留。" +
              (results.length ? "已显示本次完成的分类结果，后续分类尚未搜索。" : "已有结果可能来自上次搜索。") +
              "可退出门户后重新登录再试。");
            return;
          }
          if (!response.ok) throw new Error("搜索接口返回 HTTP " + response.status);
          var body = await response.json();
          if (current !== generation) return;
          if (!body || body.code === 0 || body.error) throw new Error("搜索接口返回失败状态");
          if (body.data && (body.data.length > 0 || body.data.total)) {
            results.push({ key: key, display: item.display, cols: item.cols, data: body.data });
          }
        }
        if (current === generation) { vm.searchList = results; status(""); }
      } catch (error) {
        if (current === generation && error.name !== "AbortError") {
          status("搜索未完成：" + error.message + "。搜索词已保留；已有结果可能来自上次搜索。");
        }
      } finally {
        if (current === generation) vm.searchLoading = false;
      }
    };
    vm.debounceGetSearchData = function () {
      clearTimeout(timer);
      invalidate();
      save(String(vm.search || ""));
      timer = setTimeout(function () { vm.getSearchData(); }, 500);
    };
    // 门户原 watcher 在清空时只隐藏面板，不会取消旧请求。
    if (typeof vm.$watch === "function") vm.$watch("search", function (value) {
      if (!value) {
        clearTimeout(timer);
        invalidate();
        save("");
        vm.searchList = [];
        status("");
      }
    });
    patched.add(vm);
    var saved = read(KEY);
    if (saved && !vm.search) { vm.search = saved; vm.searchPanelVisible = true; }
  }
  document.addEventListener("input", function (event) {
    if (event.target && event.target.matches && event.target.matches(SELECTOR)) save(event.target.value);
  }, true);
  function start() {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      var home = document.querySelector("#homeBox");
      var vm = home && home.__vue__;
      if (vm && typeof vm.getSearchData === "function" && typeof vm.debounceGetSearchData === "function") {
        patch(vm);
        clearInterval(timer);
      } else if (attempts >= 150) clearInterval(timer);
    }, 200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
