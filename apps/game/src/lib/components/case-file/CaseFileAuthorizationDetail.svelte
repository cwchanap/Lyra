<script lang="ts">
  import type { CaseFileAuthorizationItem } from "$lib/case-file/types";

  let { item }: { item: CaseFileAuthorizationItem } = $props();
  const origin = $derived(
    item.authorization.originContext.type === "migration"
      ? "已匯入的進度"
      : `${item.authorization.originContext.location.chapterTitle}・${item.authorization.originContext.location.sceneTitle}`,
  );
</script>

<div
  id="case-file-section-authorizations"
  role="tabpanel"
  aria-labelledby="case-file-tab-authorizations"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    授權：{item.authorization.label}
  </h2>
  <p>授權人：{item.authorization.grantingAuthority}</p>
  <p>許可範圍：{item.authorization.summary}</p>
  <p>來源：<span>{origin}</span></p>
</div>
