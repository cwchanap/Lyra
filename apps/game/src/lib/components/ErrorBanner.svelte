<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<div class="banner" role="alert">
  <span class="tag">ERROR&nbsp;·&nbsp;系統錯誤</span>
  <p class="msg">{message}</p>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 16px clamp(20px, 3vw, 40px);
    padding: 12px 16px;
    background: rgba(106, 10, 26, 0.4);
    color: var(--bone);
    border: 1px solid var(--crimson);
    border-left-width: 3px;
  }

  .tag {
    flex: 0 0 auto;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--crimson);
    text-transform: uppercase;
    padding-right: 12px;
    border-right: 1px solid var(--rule-strong);
  }

  .msg {
    margin: 0;
    font-family: var(--serif-jp);
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--bone);
  }
</style>
