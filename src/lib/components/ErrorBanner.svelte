<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<p class="banner" role="alert">{message}</p>

<style>
  .banner { margin: 16px; padding: 12px 14px; border-radius: 6px; color: #ffa198; background: #67060c; border: 1px solid #f85149; }
</style>
