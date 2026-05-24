<script lang="ts">
  import { onMount } from "svelte";

  let { intensity = 0.5 }: { intensity?: number } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    const cvs = canvas;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    type Drop = { x: number; y: number; len: number; speed: number; opacity: number; slant: number };
    let drops: Drop[] = [];
    let raf = 0;

    const dropOpacityScale = Math.max(0, Math.min(1, intensity));

    const makeDrop = (): Drop => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: 9 + Math.random() * 16,
      speed: 8 + Math.random() * 10,
      opacity: (0.04 + Math.random() * 0.12) * dropOpacityScale,
      slant: 0.9 + Math.random() * 0.4,
    });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cvs.width = window.innerWidth * dpr;
      cvs.height = window.innerHeight * dpr;
      cvs.style.width = `${window.innerWidth}px`;
      cvs.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const count = Math.floor((window.innerWidth * window.innerHeight) / 7000);
      drops = Array.from({ length: count }, makeDrop);
    };

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const d of drops) {
        const g = ctx.createLinearGradient(d.x, d.y, d.x - d.slant * d.len, d.y + d.len);
        g.addColorStop(0, `rgba(200, 220, 240, ${d.opacity})`);
        g.addColorStop(1, "rgba(200, 220, 240, 0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 0.8;
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

    return () => {
      window.removeEventListener("resize", resize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  });
</script>

<div class="atmosphere" aria-hidden="true">
  <div class="wash"></div>
  <canvas class="rain" bind:this={canvas}></canvas>
  <div class="halftone"></div>
  <div class="vignette"></div>
  <div class="scan"></div>
</div>

<style>
  .atmosphere {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }

  .wash {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 60% 50% at 80% 12%, rgba(212, 20, 58, 0.10), transparent 65%),
      radial-gradient(ellipse 50% 50% at 8% 92%, rgba(52, 216, 255, 0.06), transparent 70%),
      linear-gradient(170deg, #07070d 0%, #0d0612 55%, #120410 100%);
  }

  .rain {
    position: absolute;
    inset: 0;
    opacity: 0.7;
  }

  .halftone {
    position: absolute;
    inset: -10%;
    opacity: 0.12;
    mix-blend-mode: screen;
    background-image: radial-gradient(circle at center, rgba(236, 228, 207, 0.6) 0.6px, transparent 1.1px);
    background-size: 11px 11px;
    -webkit-mask-image: radial-gradient(ellipse 80% 70% at 75% 25%, black 0%, transparent 75%);
    mask-image: radial-gradient(ellipse 80% 70% at 75% 25%, black 0%, transparent 75%);
  }

  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 100% 80% at 50% 50%, transparent 50%, rgba(0, 0, 0, 0.55) 100%);
  }

  .scan {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 3px,
      rgba(0, 0, 0, 0.14) 4px
    );
    mix-blend-mode: multiply;
  }
</style>
