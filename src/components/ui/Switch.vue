<script setup>
/**
 * Switch used across the settings pane.
 *
 * reka-ui v2 models this with `modelValue` rather than the older `checked`
 * prop, so the wrapper exposes v-model and keeps the original naming for
 * readability at call sites.
 */
import { SwitchRoot, SwitchThumb } from 'reka-ui'

const props = defineProps({
  modelValue: { type: Boolean, default: undefined },
  checked: { type: Boolean, default: undefined },
  disabled: Boolean,
  label: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'update:checked'])

function onUpdate(value) {
  emit('update:modelValue', value)
  emit('update:checked', value)
}
</script>

<template>
  <SwitchRoot
    :model-value="props.modelValue ?? props.checked ?? false"
    :disabled="disabled"
    :aria-label="label || undefined"
    class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent ring-focus transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
    @update:model-value="onUpdate"
  >
    <SwitchThumb
      class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-[var(--motion-popup)] ease-[var(--motion-ease)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
    />
  </SwitchRoot>
</template>
