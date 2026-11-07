<script setup>
/**
 * Button — the shared primitive.
 *
 * Variants and sizes mirror the shipped build's button classes so the rebuilt
 * UI reads the same as the original.
 */
import { cn } from '@/lib/util.js'

const props = defineProps({
  variant: { type: String, default: 'default' }, // default | secondary | outline | ghost | destructive | link
  size: { type: String, default: 'default' }, // default | xs | sm | lg | icon
  type: { type: String, default: 'button' },
  disabled: Boolean,
  as: { type: [String, Object], default: 'button' },
  class: { type: [String, Array, Object], default: '' },
})

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  link: 'text-primary underline-offset-4 hover:underline',
}

const SIZES = {
  default: 'h-9 px-4 py-2',
  xs: 'h-6 rounded px-2 text-xs',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-8',
  icon: 'h-8 w-8',
}
</script>

<template>
  <component
    :is="as"
    :type="as === 'button' ? type : undefined"
    :disabled="disabled"
    :class="
      cn(
        'press-feedback inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium',
        'ring-focus disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant] ?? VARIANTS.default,
        SIZES[size] ?? SIZES.default,
        props.class
      )
    "
  >
    <slot />
  </component>
</template>
