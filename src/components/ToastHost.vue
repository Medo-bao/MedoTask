<script setup>
/** Toast host — mounted once in App.vue. */
import { CheckCircle2, Info, XCircle } from 'lucide-vue-next'
import { useToast } from '@/stores/toast.js'

const { state } = useToast()

const ICONS = { success: CheckCircle2, error: XCircle, info: Info }
const TONE = {
  success: 'border-green-500/40 text-green-600 dark:text-green-400',
  error: 'border-destructive/40 text-destructive',
  info: 'border-border text-foreground',
}

function holdPosition(el) {
  const { offsetLeft, offsetTop, offsetWidth } = el
  Object.assign(el.style, { left: `${offsetLeft}px`, top: `${offsetTop}px`, width: `${offsetWidth}px` })
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-1.5"
      role="status"
      aria-live="polite"
    >
      <TransitionGroup name="toast" @before-leave="holdPosition">
        <div
          v-for="item in state.items"
          :key="item.id"
          class="pointer-events-auto flex items-center gap-1.5 rounded-md border bg-popover px-3 py-1.5 text-xs shadow-md"
          :class="TONE[item.type] ?? TONE.info"
        >
          <component :is="ICONS[item.type] ?? ICONS.info" class="h-3.5 w-3.5 shrink-0" />
          <span>{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: opacity var(--motion-popup) var(--motion-ease), transform var(--motion-popup) var(--motion-ease);
}
.toast-leave-active {
  position: absolute;
  transition: opacity var(--motion-exit) var(--motion-ease), transform var(--motion-exit) var(--motion-ease);
}
.toast-move {
  transition: transform var(--motion-popup) var(--motion-ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(5px);
}
</style>
