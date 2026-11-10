/* 独立版的登录桩：身份由 start.js 按子域名决定（alice.localhost 就是 alice），这里只负责告诉页面"我是谁"。
 * 接到自己的网站时，把这个文件换成你站上的登录模块，保持 window.Auth 的这几个方法即可。 */
(function (global) {
  'use strict';
  function me() {
    return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .catch(function () { return { name: null }; });
  }
  function hint() {
    var port = location.port ? ':' + location.port : '';
    alert('本地试玩不用密码：把地址栏的主机名换成 名字.localhost 就是那个玩家。\n例如 http://alice.localhost' + port + '/board-games/index.html');
    return new Promise(function () {});
  }
  global.Auth = { me: me, login: hint, register: hint, signin: hint, logout: function () { return Promise.resolve(); }, onChange: function () {} };
})(window);
