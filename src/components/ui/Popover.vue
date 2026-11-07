<script setup>
/**
 * Popover wrapper.
 *
 * Like the dropdown wrapper, the trigger must live inside reka-ui's own
 * `PopoverTrigger` for pointer and focus handling to work.
 */
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { cn } from '@/lib/util.js'

const props = defineProps({
  align: { type: String, default: 'center' },
  side: { type: String, default: 'bottom' },
  sideOffset: { type: Number, default: 6 },
  contentClass: { type: [String, Array, Object], default: '' },
  open: { type: Boolean, default: undefined },
  asChild: { type: Boolean, default: true },
})

const emit = defineEmits(['update:open'])
</script>

<template>
  <PopoverRoot :open="props.open" @update:open="emit('update:open', $event)">
    <PopoverTrigger :as-child="props.asChild">
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :align="align"
        :side="side"
        :side-offset="sideOffset"
        :collision-padding="10"
        :class="
          cn(
            'motion-popup z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none',
            props.contentClass
          )
        "
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
