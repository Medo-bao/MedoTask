<script setup>
/**
 * Checkbox with a proper checked state.
 *
 * reka-ui v2 uses `modelValue`; the wrapper also accepts `checked` so call
 * sites can keep the attribute that reads better in markup.
 */
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { Check } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: Boolean, default: undefined },
  checked: { type: Boolean, default: false },
  disabled: Boolean,
  size: { type: String, default: 'md' }, // md | sm
})

const emit = defineEmits(['update:modelValue', 'update:checked'])

const SIZES = {
  md: 'h-4 w-4',
  sm: 'h-3.5 w-3.5',
}

function onUpdate(v) {
  const bool = v === true
  emit('update:modelValue', bool)
  emit('update:checked', bool)
}
</script>

<template>
  <CheckboxRoot
    :model-value="props.modelValue ?? props.checked"
    :disabled="disabled"
    class="press-feedback peer inline-flex shrink-0 items-center justify-center rounded border border-primary ring-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
    :class="SIZES[size] ?? SIZES.md"
    @update:model-value="onUpdate"
  >
    <CheckboxIndicator force-mount class="flex items-center justify-center transition-[opacity,scale] duration-[var(--motion-fast)] ease-[var(--motion-ease)] data-[state=unchecked]:scale-90 data-[state=unchecked]:opacity-0">
      <Check class="h-3 w-3" stroke-width="3" aria-hidden="true" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
