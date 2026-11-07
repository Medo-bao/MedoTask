<script setup>
/**
 * Dropdown menu wrapper around reka-ui.
 *
 * reka-ui needs the trigger element wrapped in its own `DropdownMenuTrigger`
 * so it can wire pointer and keyboard handling; this wrapper does that so call
 * sites only supply the visual button.
 */
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { cn } from '@/lib/util.js'

const props = defineProps({
  align: { type: String, default: 'start' },
  side: { type: String, default: 'bottom' },
  sideOffset: { type: Number, default: 6 },
  contentClass: { type: [String, Array, Object], default: '' },
  asChild: { type: Boolean, default: true },
})
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger :as-child="props.asChild">
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align"
        :side="side"
        :side-offset="sideOffset"
        :collision-padding="10"
        :class="
          cn(
            'motion-popup z-50 min-w-[9rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            props.contentClass
          )
        "
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
