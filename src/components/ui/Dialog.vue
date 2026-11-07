<script setup>
/** Modal dialog built on reka-ui, styled like the original. */
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { X } from 'lucide-vue-next'
import { nextTick, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  width: { type: String, default: 'w-[92%] max-w-sm' },
  hideClose: Boolean,
  closable: { type: Boolean, default: true },
  returnFocus: { type: Object, default: null },
})

const emit = defineEmits(['update:open'])

let opener = null
watch(() => props.open, (open) => {
  if (open) opener = document.activeElement
}, { flush: 'sync' })

function restoreFocus(event) {
  const target = props.returnFocus ?? opener
  opener = null
  const activeElement = document.activeElement
  if (!target?.isConnected || target === document.body) return
  if (activeElement !== document.body && !event.target.contains(activeElement)) return
  event.preventDefault()
  nextTick(() => target.focus({ preventScroll: true }))
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <slot name="trigger" />
    <DialogPortal>
      <DialogOverlay
        class="motion-overlay fixed inset-0 z-50 bg-black/60"
      />
      <DialogContent
        class="motion-dialog scroll-thin fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
        :class="width"
        :inert="!open"
        @close-auto-focus="restoreFocus"
      >
        <div v-if="title || $slots.header" class="flex flex-col gap-1">
          <DialogTitle v-if="title" class="text-base font-semibold leading-tight">
            {{ title }}
          </DialogTitle>
          <DialogDescription v-if="description" class="text-xs text-muted-foreground">
            {{ description }}
          </DialogDescription>
          <slot name="header" />
        </div>

        <slot />

        <div v-if="$slots.footer" class="flex items-center justify-end gap-2 pt-1">
          <slot name="footer" />
        </div>

        <DialogClose
          v-if="closable && !hideClose"
          class="press-feedback absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground ring-focus"
          aria-label="关闭"
        >
          <X class="h-3.5 w-3.5" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
