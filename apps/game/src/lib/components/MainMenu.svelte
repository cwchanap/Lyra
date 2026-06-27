<script lang="ts">
  import { onMount } from "svelte";
  import {
    audioPreferences,
    updateAudioPreferences,
  } from "$lib/audio/gameplay-audio-runtime.svelte";
  import AudioSettings from "./AudioSettings.svelte";

  type Props = {
    onNewGame: () => void;
    onContinue?: () => void;
    onArchive?: () => void;
    onSettings?: () => void;
    onExit?: () => void;
    disabled?: boolean;
  };

  const {
    onNewGame,
    onContinue,
    onArchive,
    onSettings,
    onExit,
    disabled = false,
  }: Props = $props();

  let clock = $state("— : — : —");
  let weather: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    const tickClock = () => {
      const now = new Date();
      const jst = new Date(
        now.getTime() + (now.getTimezoneOffset() + 540) * 60000,
      );
      const p = (n: number) => String(n).padStart(2, "0");
      clock = `${p(jst.getHours())} : ${p(jst.getMinutes())} : ${p(jst.getSeconds())} JST`;
    };
    tickClock();
    const clockTimer = window.setInterval(tickClock, 1000);

    const cvs = weather;
    if (!cvs) return () => window.clearInterval(clockTimer);
    const ctx = cvs.getContext("2d");
    if (!ctx) return () => window.clearInterval(clockTimer);

    type Drop = {
      x: number;
      y: number;
      len: number;
      speed: number;
      opacity: number;
      slant: number;
    };
    let drops: Drop[] = [];
    let raf = 0;

    const makeDrop = (): Drop => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: 10 + Math.random() * 20,
      speed: 10 + Math.random() * 14,
      opacity: 0.1 + Math.random() * 0.22,
      slant: 1.0 + Math.random() * 0.4,
    });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cvs.width = window.innerWidth * dpr;
      cvs.height = window.innerHeight * dpr;
      cvs.style.width = `${window.innerWidth}px`;
      cvs.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const count = Math.floor((window.innerWidth * window.innerHeight) / 4800);
      drops = Array.from({ length: count }, makeDrop);
    };

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const d of drops) {
        const g = ctx.createLinearGradient(
          d.x,
          d.y,
          d.x - d.slant * d.len,
          d.y + d.len,
        );
        g.addColorStop(0, `rgba(200, 220, 240, ${d.opacity})`);
        g.addColorStop(1, "rgba(200, 220, 240, 0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.slant * d.len, d.y + d.len);
        ctx.stroke();
        d.x -= d.slant * d.speed * 0.18;
        d.y += d.speed;
        if (d.y > window.innerHeight + 20) {
          d.y = -20;
          d.x = Math.random() * (window.innerWidth + 200);
        }
        if (d.x < -40) d.x = window.innerWidth + 40;
      }
      raf = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(draw);

    const cards = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".lyra-menu .card:not(:disabled)",
      ),
    );
    let focusIndex = 0;
    const focusCard = (n: number) => {
      if (cards.length === 0) return;
      focusIndex = (n + cards.length) % cards.length;
      cards[focusIndex].focus();
    };
    const onKey = (e: KeyboardEvent) => {
      // When focus is on an interactive form control (the footer's audio
      // sliders, a future input, a contenteditable, etc.), let the control
      // handle ArrowUp/ArrowDown natively instead of hijacking them for card
      // navigation. Without this guard, focusing a BGM/BGS/SFX range input and
      // pressing an arrow key would preventDefault() and jump focus to a menu
      // card, so the slider value could not be adjusted with the keyboard.
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusCard(focusIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusCard(focusIndex - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => cards[0]?.focus(), 1500);

    return () => {
      window.clearInterval(clockTimer);
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      if (raf) window.cancelAnimationFrame(raf);
    };
  });
</script>

<div class="lyra-menu">
  <div class="stage" aria-hidden="true">
    <canvas class="weather" bind:this={weather}></canvas>
    <div class="halftone"></div>
    <div class="speedlines"></div>
    <div class="slash top"></div>
    <div class="slash bottom"></div>
    <div class="slash diag"></div>
    <div class="glyph-zero shadow">零</div>
    <div class="glyph-zero">零</div>
    <div class="glyph-ame">雨</div>
    <div class="grain"></div>
    <div class="scan"></div>
  </div>

  <main class="menu" aria-label="主選單">
    <div class="titlebar">
      <div class="titlebar-left">
        <span class="case-marker"
          ><span class="diamond"
          ></span>EP.&nbsp;ZERO&nbsp;·&nbsp;CASE&nbsp;OPEN</span
        >
        <span class="kana-strip">トウキョウ・アメ・ショウ</span>
      </div>
      <div class="titlebar-right">
        <span><span class="dot"></span>KAGAMI 連線中</span>
        <span class="vline"></span>
        <span>FILE&nbsp;00&nbsp;/&nbsp;08</span>
        <span class="vline"></span>
        <span>{clock}</span>
      </div>
    </div>

    <section class="hero">
      <div class="eye-wrap" aria-hidden="true">
        <svg viewBox="0 0 560 400" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="lyra-iris" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stop-color="#3a9fc8" />
              <stop offset="40%" stop-color="#1d6488" />
              <stop offset="78%" stop-color="#0c2a4a" />
              <stop offset="100%" stop-color="#06101f" />
            </radialGradient>
            <radialGradient id="lyra-iris-inner" cx="50%" cy="60%" r="40%">
              <stop offset="0%" stop-color="#d4143a" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#d4143a" stop-opacity="0" />
            </radialGradient>
            <linearGradient id="lyra-upper-lid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#040408" />
              <stop offset="100%" stop-color="#100513" />
            </linearGradient>
            <clipPath id="lyra-eye-shape">
              <path
                d="M30,210 Q170,40 290,40 Q430,40 530,210 Q430,360 290,360 Q170,360 30,210 Z"
              />
            </clipPath>
          </defs>

          <g clip-path="url(#lyra-eye-shape)">
            <rect x="0" y="0" width="560" height="400" fill="#ece4cf" />
            <g>
              <ellipse
                cx="280"
                cy="210"
                rx="135"
                ry="155"
                fill="url(#lyra-iris)"
              />
              <ellipse
                cx="280"
                cy="240"
                rx="120"
                ry="120"
                fill="url(#lyra-iris-inner)"
              />
              <ellipse
                cx="280"
                cy="210"
                rx="135"
                ry="155"
                fill="none"
                stroke="#040408"
                stroke-width="3"
                stroke-opacity="0.5"
              />

              <g opacity="0.55">
                <rect x="178" y="240" width="22" height="80" fill="#04060f" />
                <rect x="202" y="220" width="14" height="100" fill="#04060f" />
                <rect x="218" y="260" width="28" height="60" fill="#04060f" />
                <rect x="248" y="200" width="18" height="120" fill="#04060f" />
                <rect x="268" y="235" width="24" height="85" fill="#04060f" />
                <rect x="294" y="215" width="16" height="105" fill="#04060f" />
                <rect x="312" y="245" width="22" height="75" fill="#04060f" />
                <rect x="336" y="225" width="14" height="95" fill="#04060f" />
                <rect x="352" y="255" width="26" height="65" fill="#04060f" />
                <polygon points="262,160 270,250 254,250" fill="#d4143a" />
                <rect x="260" y="160" width="4" height="14" fill="#d4143a" />
                <circle cx="262" cy="158" r="2.4" fill="#ece4cf" />
                <g fill="#b08545" opacity="0.75">
                  <rect x="184" y="258" width="3" height="3" />
                  <rect x="192" y="270" width="3" height="3" />
                  <rect x="206" y="232" width="3" height="3" />
                  <rect x="252" y="214" width="3" height="3" />
                  <rect x="258" y="232" width="3" height="3" />
                  <rect x="296" y="226" width="3" height="3" />
                  <rect x="316" y="258" width="3" height="3" />
                  <rect x="340" y="240" width="3" height="3" />
                  <rect x="356" y="268" width="3" height="3" />
                </g>
              </g>

              <g
                stroke="#ece4cf"
                stroke-width="1.2"
                opacity="0.4"
                stroke-linecap="round"
              >
                <line x1="200" y1="150" x2="195" y2="170" />
                <line x1="220" y1="120" x2="215" y2="146" />
                <line x1="240" y1="160" x2="234" y2="184" />
                <line x1="260" y1="130" x2="254" y2="152" />
                <line x1="280" y1="110" x2="274" y2="136" />
                <line x1="300" y1="140" x2="294" y2="166" />
                <line x1="320" y1="120" x2="314" y2="146" />
                <line x1="340" y1="160" x2="334" y2="184" />
                <line x1="360" y1="135" x2="354" y2="160" />
              </g>

              <ellipse cx="280" cy="220" rx="46" ry="70" fill="#040408" />
              <ellipse
                cx="252"
                cy="172"
                rx="22"
                ry="32"
                fill="#ece4cf"
                opacity="0.92"
              />
              <ellipse
                cx="320"
                cy="260"
                rx="5"
                ry="7"
                fill="#d4143a"
                opacity="0.9"
              />
            </g>

            <path
              d="M30,210 Q170,40 290,40 Q430,40 530,210 L530,90 Q300,30 30,90 Z"
              fill="url(#lyra-upper-lid)"
              opacity="0.92"
            />
          </g>

          <path
            d="M30,210 Q170,40 290,40 Q430,40 530,210 Q430,360 290,360 Q170,360 30,210 Z"
            fill="none"
            stroke="#040408"
            stroke-width="6"
            stroke-linejoin="round"
          />

          <g
            stroke="#040408"
            stroke-width="9"
            stroke-linecap="round"
            fill="none"
          >
            <path d="M90,130 Q70,80 50,60" />
            <path d="M150,80 Q140,40 130,10" />
            <path d="M220,55 Q215,18 210,-10" />
            <path d="M300,46 Q302,8 302,-22" />
            <path d="M380,58 Q388,20 396,-8" />
            <path d="M450,90 Q466,55 480,30" />
            <path d="M510,150 Q540,120 564,108" />
          </g>

          <path
            d="M120,-10 Q260,-30 460,10"
            stroke="#040408"
            stroke-width="14"
            fill="none"
            stroke-linecap="round"
          />

          <g opacity="0.85">
            <path
              d="M180,320 Q186,348 192,362 Q198,348 204,320 Z"
              fill="#34d8ff"
            />
            <ellipse cx="190" cy="336" rx="2" ry="2.6" fill="#ece4cf" />
          </g>
        </svg>

        <div class="hero-caption">
          <b>九十秒</b>。咖啡的香氣、雨聲、心跳——<br />
          這段空白裡，誰偷走了真相？」
        </div>
      </div>

      <div class="title-block">
        <div class="row-jp">トウキョウ・レイン・テスティモニー</div>
        <div class="row-zh">東京雨證<br /><em>第零</em>證人</div>
        <div class="row-en">— Tokyo Rain Testimony</div>
      </div>
    </section>

    <nav class="deck" aria-label="選單項目">
      <button class="card primary" type="button" onclick={onNewGame} {disabled}>
        <span class="num">01</span>
        <span class="label">
          <span class="zh" data-text="開始調查">開始調查</span>
          <span class="sub"
            >NEW GAME&nbsp;·&nbsp;<b>第一章「雨鐘咖啡館」</b></span
          >
        </span>
        <span class="chip">ENTER&nbsp;▶</span>
      </button>

      <button
        class="card"
        type="button"
        onclick={onContinue}
        disabled={disabled || !onContinue}
      >
        <span class="num">02</span>
        <span class="label">
          <span class="zh" data-text="繼續追蹤">繼續追蹤</span>
          <span class="sub">CONTINUE&nbsp;·&nbsp;<b>尚未啟用</b></span>
        </span>
        <span class="chip">LOAD</span>
      </button>

      <button
        class="card"
        type="button"
        onclick={onArchive}
        disabled={disabled || !onArchive}
      >
        <span class="num">03</span>
        <span class="label">
          <span class="zh" data-text="案件檔案">案件檔案</span>
          <span class="sub">FILES&nbsp;·&nbsp;<b>尚未啟用</b></span>
        </span>
        <span class="chip">OPEN</span>
      </button>

      <button
        class="card"
        type="button"
        onclick={onSettings}
        disabled={disabled || !onSettings}
      >
        <span class="num">04</span>
        <span class="label">
          <span class="zh" data-text="系統設定">系統設定</span>
          <span class="sub">CONFIG&nbsp;·&nbsp;尚未啟用</span>
        </span>
        <span class="chip">EDIT</span>
      </button>

      <button
        class="card danger"
        type="button"
        onclick={onExit}
        disabled={disabled || !onExit}
      >
        <span class="num">05</span>
        <span class="label">
          <span class="zh" data-text="結束偵查">結束偵查</span>
          <span class="sub">QUIT&nbsp;·&nbsp;<b>登出 KAGAMI</b></span>
        </span>
        <span class="chip">EXIT&nbsp;✕</span>
      </button>
    </nav>

    <footer class="footer">
      <div class="footer-row">
        <div class="narration">
          ▸ 序章·東京。<b>雨</b
          >把這座城市的影子洗得更深了——而某個人，正在這場雨裡，<em>決定</em
          >你會先看見哪一塊真相。
        </div>
        <div class="footer-center">— Episode Zero · Continue? —</div>
        <div class="keys">
          <span><kbd>↑</kbd><kbd>↓</kbd>選擇</span>
          <span><kbd>↵</kbd>確定</span>
          <span><kbd>esc</kbd>返回</span>
        </div>
      </div>
      <div class="footer-audio">
        <AudioSettings
          preferences={audioPreferences}
          onUpdate={updateAudioPreferences}
        />
      </div>
    </footer>
  </main>
</div>

<style>
  .lyra-menu {
    position: fixed;
    inset: 0;
    background: var(--bg-deep);
    color: var(--bone);
    font-family: var(--body-jp);
    overflow: hidden;
  }

  .lyra-menu *,
  .lyra-menu *::before,
  .lyra-menu *::after {
    box-sizing: border-box;
  }

  .stage {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background:
      radial-gradient(
        ellipse 55% 65% at 78% 30%,
        rgba(212, 20, 58, 0.22),
        transparent 65%
      ),
      radial-gradient(
        ellipse 60% 55% at 12% 86%,
        rgba(52, 216, 255, 0.1),
        transparent 70%
      ),
      linear-gradient(170deg, #07070d 0%, #100513 50%, #1a0510 100%);
  }

  .halftone {
    position: absolute;
    inset: -10%;
    pointer-events: none;
    opacity: 0.22;
    mix-blend-mode: screen;
    background-image: radial-gradient(
      circle at center,
      rgba(236, 228, 207, 0.6) 0.7px,
      transparent 1.2px
    );
    background-size: 9px 9px;
    -webkit-mask-image: radial-gradient(
      ellipse 70% 70% at 70% 30%,
      black 0%,
      transparent 72%
    );
    mask-image: radial-gradient(
      ellipse 70% 70% at 70% 30%,
      black 0%,
      transparent 72%
    );
  }

  .speedlines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.08;
    background: repeating-conic-gradient(
      from 0deg at 82% 42%,
      transparent 0deg,
      transparent 2.4deg,
      rgba(236, 228, 207, 0.7) 2.5deg,
      transparent 2.7deg
    );
    -webkit-mask-image: radial-gradient(
      circle at 82% 42%,
      transparent 22%,
      black 65%,
      transparent 100%
    );
    mask-image: radial-gradient(
      circle at 82% 42%,
      transparent 22%,
      black 65%,
      transparent 100%
    );
    mix-blend-mode: screen;
  }

  .scan {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 60;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 3px,
      rgba(0, 0, 0, 0.22) 4px
    );
    mix-blend-mode: multiply;
  }

  .grain {
    position: absolute;
    inset: -50%;
    pointer-events: none;
    z-index: 55;
    opacity: 0.15;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.9   0 0 0 0 0.86  0 0 0 0 0.78   0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    animation: lyra-grain-shift 1.4s steps(6) infinite;
  }
  @keyframes lyra-grain-shift {
    0% {
      transform: translate(0, 0);
    }
    25% {
      transform: translate(-4%, 3%);
    }
    50% {
      transform: translate(3%, -2%);
    }
    75% {
      transform: translate(-2%, -4%);
    }
    100% {
      transform: translate(0, 0);
    }
  }

  canvas.weather {
    position: absolute;
    inset: 0;
    z-index: 5;
    opacity: 0.88;
  }

  .slash {
    position: absolute;
    z-index: 8;
  }
  .slash.top {
    top: -6vh;
    left: -10vw;
    right: -10vw;
    height: 8vh;
    background: linear-gradient(
      90deg,
      var(--cell) 0%,
      var(--cell) 68%,
      var(--crimson) 68%,
      var(--crimson) 100%
    );
    transform: rotate(-1.6deg);
    border-bottom: 1px solid var(--rule-strong);
  }
  .slash.bottom {
    bottom: -6vh;
    left: -10vw;
    right: -10vw;
    height: 7vh;
    background: linear-gradient(
      90deg,
      var(--crimson) 0%,
      var(--crimson) 30%,
      var(--cell) 30%,
      var(--cell) 100%
    );
    transform: rotate(-1.2deg);
    border-top: 1px solid var(--rule-strong);
  }
  .slash.diag {
    top: 10vh;
    bottom: 10vh;
    left: 49%;
    width: 1px;
    transform: rotate(-5deg);
    background: var(--crimson);
    box-shadow: 0 0 14px rgba(212, 20, 58, 0.55);
    opacity: 0.55;
  }

  .glyph-zero {
    position: absolute;
    z-index: 6;
    left: -6vw;
    top: 16vh;
    font-family: var(--display-jp);
    font-size: clamp(380px, 56vw, 900px);
    line-height: 0.78;
    color: transparent;
    -webkit-text-stroke: 2px var(--crimson);
    pointer-events: none;
    user-select: none;
    opacity: 0.85;
    animation: lyra-zero-pop 1.1s cubic-bezier(0.2, 0.9, 0.2, 1) 0.1s both;
  }
  .glyph-zero.shadow {
    color: var(--bg-blood);
    -webkit-text-stroke: 0;
    z-index: 5;
    transform: translate(10px, 12px);
    opacity: 1;
  }
  @keyframes lyra-zero-pop {
    0% {
      transform: translate(-30px, 16px);
      opacity: 0;
    }
    100% {
      transform: translate(0, 0);
      opacity: 0.85;
    }
  }

  .glyph-ame {
    position: absolute;
    z-index: 7;
    right: -1vw;
    bottom: 12vh;
    font-family: var(--display-jp);
    font-size: clamp(150px, 20vw, 320px);
    line-height: 0.78;
    color: transparent;
    -webkit-text-stroke: 1.5px rgba(236, 228, 207, 0.28);
    transform: rotate(6deg);
    pointer-events: none;
    user-select: none;
    animation: lyra-ame-pop 1.1s cubic-bezier(0.2, 0.9, 0.2, 1) 0.4s both;
  }
  @keyframes lyra-ame-pop {
    0% {
      transform: rotate(6deg) translate(40px, -16px);
      opacity: 0;
    }
    100% {
      transform: rotate(6deg) translate(0, 0);
      opacity: 1;
    }
  }

  .menu {
    position: relative;
    z-index: 20;
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    grid-template-rows: auto 1fr auto;
    height: 100vh;
    padding: 28px clamp(28px, 4vw, 56px);
    gap: 24px;
  }

  .titlebar {
    grid-column: 1 / -1;
    grid-row: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--rule);
  }
  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .case-marker {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.32em;
    color: var(--bone);
    padding: 7px 12px 6px;
    border: 1px solid var(--crimson);
    background: rgba(212, 20, 58, 0.08);
    text-transform: uppercase;
  }
  .case-marker .diamond {
    width: 6px;
    height: 6px;
    background: var(--crimson);
    transform: rotate(45deg);
    box-shadow: 0 0 8px var(--crimson);
  }

  .kana-strip {
    font-family: var(--serif-jp);
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.5em;
    color: var(--bone-dim);
  }

  .titlebar-right {
    display: flex;
    gap: 22px;
    align-items: center;
    font-family: var(--mono);
    font-weight: 400;
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--bone-dim);
    text-transform: uppercase;
  }
  .titlebar-right .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--crimson);
    border-radius: 50%;
    margin-right: 6px;
    box-shadow: 0 0 8px var(--crimson);
    animation: lyra-pulse 2.2s ease-in-out infinite;
  }

  .vline {
    width: 1px;
    height: 16px;
    background: var(--rule-strong);
  }

  .hero {
    grid-column: 1;
    grid-row: 2;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 40px;
  }
  .eye-wrap {
    position: relative;
    width: min(560px, 80%);
    aspect-ratio: 1.4 / 1;
    animation: lyra-hero-in 1.2s cubic-bezier(0.2, 0.9, 0.2, 1) 0.45s both;
  }
  @keyframes lyra-hero-in {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .eye-wrap svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .hero-caption {
    position: absolute;
    left: 4%;
    bottom: -16px;
    font-family: var(--body-jp);
    font-weight: 400;
    font-size: 14.5px;
    letter-spacing: 0.06em;
    line-height: 1.55;
    background: var(--char);
    color: var(--bone);
    padding: 14px 18px 12px;
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--crimson);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    max-width: 380px;
  }
  .hero-caption b {
    font-weight: 700;
    color: var(--crimson);
    border-bottom: 1px solid var(--crimson);
    padding-bottom: 1px;
  }
  .hero-caption::before {
    content: "「";
    position: absolute;
    top: -2px;
    left: 8px;
    font-family: var(--display-jp);
    font-size: 22px;
    color: var(--crimson);
  }

  .title-block {
    position: absolute;
    right: -8%;
    top: 0;
    text-align: right;
    animation: lyra-hero-in 1.2s cubic-bezier(0.2, 0.9, 0.2, 1) 0.65s both;
  }
  .title-block .row-jp {
    font-family: var(--serif-jp);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.48em;
    color: var(--crimson);
    margin-bottom: 8px;
  }
  .title-block .row-zh {
    font-family: var(--display-jp);
    font-size: clamp(36px, 4.2vw, 64px);
    line-height: 0.96;
    color: var(--bone);
    text-shadow: 4px 4px 0 var(--cell);
    letter-spacing: 0.04em;
  }
  .title-block .row-zh em {
    font-style: normal;
    color: var(--crimson);
  }
  .title-block .row-en {
    font-family: var(--serif-it);
    font-style: italic;
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.36em;
    color: var(--bone-dim);
    margin-top: 12px;
    text-transform: uppercase;
  }

  .deck {
    grid-column: 2;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding-right: 8px;
  }

  .card {
    position: relative;
    display: grid;
    grid-template-columns: 72px 1fr auto;
    align-items: center;
    gap: 18px;
    padding: 18px 22px 18px 26px;
    background: var(--char);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    outline: none;
    clip-path: polygon(
      0 0,
      calc(100% - 18px) 0,
      100% 18px,
      100% 100%,
      18px 100%,
      0 calc(100% - 18px)
    );
    transition:
      transform 0.22s cubic-bezier(0.2, 0.9, 0.2, 1),
      background 0.22s ease,
      border-color 0.22s ease;
    animation: lyra-card-in 0.6s cubic-bezier(0.2, 0.9, 0.2, 1) both;
  }
  .card:nth-child(1) {
    animation-delay: 0.75s;
  }
  .card:nth-child(2) {
    animation-delay: 0.88s;
  }
  .card:nth-child(3) {
    animation-delay: 1.01s;
  }
  .card:nth-child(4) {
    animation-delay: 1.14s;
  }
  .card:nth-child(5) {
    animation-delay: 1.27s;
  }
  @keyframes lyra-card-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .card::after {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--crimson);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform 0.25s cubic-bezier(0.6, 0, 0.3, 1);
  }
  .card:hover:not(:disabled)::after,
  .card:focus-visible:not(:disabled)::after {
    transform: scaleY(1);
  }

  .card:hover:not(:disabled),
  .card:focus-visible:not(:disabled) {
    transform: translateX(-4px);
    background: var(--char-2);
    border-color: rgba(212, 20, 58, 0.5);
  }
  .card:active:not(:disabled) {
    transform: translateX(0);
  }
  .card:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .card .num {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 44px;
    line-height: 1;
    color: var(--bone-dim);
    transition: color 0.2s;
  }
  .card:hover:not(:disabled) .num,
  .card:focus-visible:not(:disabled) .num {
    color: var(--crimson);
  }
  .card.primary .num {
    color: var(--bone);
  }

  .card .label .zh {
    font-family: var(--display-jp);
    font-size: 26px;
    letter-spacing: 0.1em;
    line-height: 1;
    color: var(--bone);
    display: block;
    position: relative;
  }
  .card .label .zh::after {
    content: attr(data-text);
    position: absolute;
    left: 0;
    top: 0;
    color: var(--cyan);
    opacity: 0;
    transform: translate(2px, 0);
    pointer-events: none;
  }
  .card:hover:not(:disabled) .label .zh::after,
  .card:focus-visible:not(:disabled) .label .zh::after {
    opacity: 0.4;
    animation: lyra-glitch 0.7s steps(7) infinite;
  }

  .card .label .sub {
    display: block;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }
  .card .label .sub b {
    color: var(--bone-dim);
    font-weight: 400;
  }

  .card .chip {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.22em;
    color: var(--bone-dim);
    padding: 6px 10px 5px;
    border: 1px solid var(--rule-strong);
    white-space: nowrap;
    text-transform: uppercase;
  }
  .card.primary .chip {
    color: var(--crimson);
    border-color: var(--crimson);
    background: rgba(212, 20, 58, 0.08);
  }

  .footer {
    grid-column: 1 / -1;
    grid-row: 3;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 0 0;
    border-top: 1px solid var(--rule);
  }
  .footer-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
  }
  .footer-audio {
    display: flex;
    justify-content: center;
  }
  .footer-audio > :global(.audio-settings) {
    max-width: 560px;
  }
  .narration {
    color: var(--bone);
    padding: 8px 0 8px 18px;
    border-left: 2px solid var(--crimson);
    font-family: var(--body-jp);
    font-weight: 400;
    font-size: 13.5px;
    line-height: 1.6;
    letter-spacing: 0.04em;
    max-width: 560px;
  }
  .narration b {
    font-weight: 700;
    color: var(--crimson);
  }
  .narration em {
    font-style: italic;
    color: var(--bone-dim);
    font-family: var(--serif-it);
  }

  .footer-center {
    text-align: center;
    font-family: var(--serif-it);
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.36em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  .keys {
    display: flex;
    gap: 14px;
    align-items: center;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    color: var(--bone-dim);
    text-transform: uppercase;
  }
  .keys kbd {
    display: inline-block;
    padding: 3px 7px 2px;
    background: transparent;
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    font-family: var(--mono);
    font-size: 10px;
    margin-right: 4px;
  }

  @media (max-width: 980px) {
    .lyra-menu {
      overflow-y: auto;
    }
    .menu {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto auto;
      height: auto;
      min-height: 100vh;
    }
    .hero {
      grid-column: 1;
      grid-row: 2;
      padding: 80px 0 40px;
    }
    .deck {
      grid-column: 1;
      grid-row: 3;
    }
    .title-block {
      right: 4%;
      top: 12px;
    }
    .glyph-zero {
      top: 24vh;
      font-size: 60vw;
    }
  }
</style>
