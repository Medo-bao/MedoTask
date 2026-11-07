<script setup>
/** About dialog: version, links and data actions. */
import { computed } from 'vue'
import Dialog from './ui/Dialog.vue'
import Button from './ui/Button.vue'
import { useWindows } from '@/composables/useWindows.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open'])

const windows = useWindows()
const version = computed(() => __APP_VERSION__)
</script>

<template>
  <Dialog
    :open="props.open"
    title="关于"
    width="w-[92%] max-w-xs"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-2 text-center text-xs text-muted-foreground">
      <div class="text-sm font-semibold text-foreground">MedoTask</div>
      <div>版本 {{ version }}</div>
      <div>基于 Kite 0.2.0 重写 · 离线优先</div>
      <div class="pt-1 text-[11px]">所有数据保存在本机浏览器</div>
    </div>

    <template #footer>
      <Button variant="secondary" class="flex-1" @click="windows.open('setting')">设置</Button>
      <Button variant="outline" class="flex-1" @click="emit('update:open', false)">关闭</Button>
    </template>
  </Dialog>
</template>
