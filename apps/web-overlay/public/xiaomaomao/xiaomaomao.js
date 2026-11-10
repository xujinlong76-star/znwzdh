// 小猫猫网站吉祥物挂件（矢量版）：右下角悬浮漂浮，悬停打招呼，点击换动作并开口说话
// 用法：把本文件放进 Next.js 的 public/xiaomaomao/ 目录，在根 layout 的 </body> 前
// 加 <Script src="/xiaomaomao/xiaomaomao.js" strategy="afterInteractive" />
// 图片是内嵌 SVG（粉色小猫 + 金铃铛），不依赖任何外部图片文件。
// 说话功能用浏览器内置的 Web Speech API（speechSynthesis）朗读台词，优先选中文女声、
// 音调略高更像小猫；声音来自访客自己设备的系统语音。右下角小喇叭按钮可开关语音。
(function () {
  function cat(eyes, paw) {
    var eyeOpen =
      '<ellipse cx="76" cy="96" rx="9" ry="12" fill="#402e32"/>' +
      '<ellipse cx="124" cy="96" rx="9" ry="12" fill="#402e32"/>' +
      '<circle cx="79" cy="91" r="3.6" fill="#fff"/><circle cx="127" cy="91" r="3.6" fill="#fff"/>' +
      '<circle cx="73.5" cy="101" r="1.8" fill="#fff"/><circle cx="121.5" cy="101" r="1.8" fill="#fff"/>' +
      '<path d="M64 84 l-6 -5 M68 81 l-3 -7 M132 81 l3 -7 M136 84 l6 -5" stroke="#402e32" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
    var eyeHappy =
      '<path d="M66 98 q10 -13 20 0 M114 98 q10 -13 20 0" stroke="#402e32" stroke-width="4" stroke-linecap="round" fill="none"/>' +
      '<path d="M64 84 l-6 -5 M136 84 l6 -5" stroke="#402e32" stroke-width="2.4" stroke-linecap="round"/>';
    var eyeSleep =
      '<path d="M66 96 q10 8 20 0 M114 96 q10 8 20 0" stroke="#402e32" stroke-width="4" stroke-linecap="round" fill="none"/>' +
      '<text x="152" y="52" font-size="17" fill="#ff8fab" font-family="sans-serif" font-weight="bold">z</text>' +
      '<text x="164" y="38" font-size="13" fill="#ffb6c9" font-family="sans-serif" font-weight="bold">z</text>';
    var eyeHtml = eyes === 'happy' ? eyeHappy : eyes === 'sleep' ? eyeSleep : eyeOpen;
    var pawDown =
      '<ellipse cx="66" cy="176" rx="15" ry="9" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2"/>' +
      '<ellipse cx="134" cy="176" rx="15" ry="9" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2"/>';
    var pawWave =
      '<ellipse cx="66" cy="176" rx="15" ry="9" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2"/>' +
      '<path d="M150 138 q22 -8 18 -34" stroke="#ff9fb8" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      '<circle cx="168" cy="100" r="11" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2"/>';
    var pawHtml = paw === 'wave' ? pawWave : pawDown;
    return '' +
      '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="小猫猫">' +
      '<path d="M158 168 q34 -4 30 -34 q-2 -14 -14 -16" fill="none" stroke="#ff9fb8" stroke-width="11" stroke-linecap="round"/>' +
      '<ellipse cx="100" cy="150" rx="52" ry="36" fill="#ffc7d6"/>' +
      '<ellipse cx="100" cy="158" rx="32" ry="24" fill="#ffe3ec"/>' +
      '<path d="M52 62 L44 22 L84 40 Z" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M148 62 L156 22 L116 40 Z" fill="#ffc7d6" stroke="#ff9fb8" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M54 54 L50 33 L74 43 Z" fill="#ff8fab"/>' +
      '<path d="M146 54 L150 33 L126 43 Z" fill="#ff8fab"/>' +
      '<circle cx="100" cy="94" r="56" fill="#ffc7d6"/>' +
      '<ellipse cx="60" cy="114" rx="10" ry="6" fill="#ff9fb8" opacity="0.65"/>' +
      '<ellipse cx="140" cy="114" rx="10" ry="6" fill="#ff9fb8" opacity="0.65"/>' +
      eyeHtml +
      '<path d="M95 108 h10 l-5 6 z" fill="#e75480"/>' +
      '<path d="M100 114 q0 6 -7 6 M100 114 q0 6 7 6" stroke="#c2436e" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      '<path d="M30 104 h26 M33 116 l24 -4 M170 104 h-26 M167 116 l-24 -4" stroke="#e8a2b8" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M64 128 q36 14 72 0" stroke="#e75480" stroke-width="8" fill="none"/>' +
      '<circle cx="100" cy="136" r="9" fill="#ffd93d" stroke="#e0a800" stroke-width="2"/>' +
      '<path d="M92 133 h16 M100 140 v4" stroke="#e0a800" stroke-width="2"/>' +
      '<circle cx="100" cy="142" r="1.8" fill="#8a6100"/>' +
      pawHtml +
      '</svg>';
  }
  var poses = [
    { svg: cat('open', 'down'), text: '你好，我是小猫猫' },
    { svg: cat('open', 'wave'), text: '嗨，我在跟你招手' },
    { svg: cat('happy', 'down'), text: '今天也要开心呀' },
    { svg: cat('sleep', 'down'), text: '困了，我眯一会儿' }
  ];
  var i = 0;
  var voiceOn = true;
  function speak(text) {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.pitch = 1.35;
      u.rate = 1.02;
      var voices = window.speechSynthesis.getVoices();
      for (var v = 0; v < voices.length; v++) {
        if (/^zh/i.test(voices[v].lang)) { u.voice = voices[v]; break; }
      }
      window.speechSynthesis.speak(u);
    } catch (e) { /* 浏览器不支持或被拦截时静默，不影响换动作 */ }
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
    }
  }
  var box = document.createElement('div');
  box.id = 'xiaomaomao';
  box.innerHTML = '<div class="xm-bubble">' + poses[0].text + '</div><div class="xm-cat">' + poses[0].svg + '</div>' +
    '<button class="xm-voice" type="button" title="开关小猫语音" aria-label="开关小猫语音">🔊</button>';
  var style = document.createElement('style');
  style.textContent =
    '#xiaomaomao{position:fixed;right:18px;bottom:18px;width:110px;z-index:9999;text-align:center;cursor:pointer}' +
    '#xiaomaomao .xm-cat{width:100%;animation:xmFloat 3s ease-in-out infinite;filter:drop-shadow(0 6px 12px rgba(0,0,0,.18))}' +
    '#xiaomaomao .xm-cat svg{width:100%;height:auto;display:block}' +
    '@keyframes xmFloat{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-8px) rotate(1.5deg)}}' +
    '#xiaomaomao .xm-bubble{opacity:0;transition:opacity .3s;background:#fff;color:#d6336c;border:2px solid #ffb6c9;border-radius:14px;padding:4px 8px;font-size:13px;margin-bottom:4px}' +
    '#xiaomaomao:hover .xm-bubble{opacity:1}' +
    '#xiaomaomao .xm-voice{position:absolute;right:-6px;top:22px;width:26px;height:26px;border-radius:50%;border:2px solid #ffb6c9;background:#fff;font-size:13px;line-height:1;cursor:pointer;padding:0}';
  document.head.appendChild(style);
  document.body.appendChild(box);
  box.querySelector('.xm-voice').addEventListener('click', function (ev) {
    ev.stopPropagation();
    voiceOn = !voiceOn;
    this.textContent = voiceOn ? '🔊' : '🔇';
    if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (voiceOn) speak(poses[i].text);
  });
  box.addEventListener('click', function () {
    i = (i + 1) % poses.length;
    box.querySelector('.xm-cat').innerHTML = poses[i].svg;
    var bubble = box.querySelector('.xm-bubble');
    bubble.textContent = poses[i].text;
    bubble.style.opacity = 1;
    speak(poses[i].text);
  });
})();
