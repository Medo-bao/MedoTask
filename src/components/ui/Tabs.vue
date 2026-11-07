<script setup>
/** Tab bar used by the settings window. */
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/util.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  tabs: { type: Array, default: () => [] }, // [{ value, label, icon }]
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <TabsRoot :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <TabsList class="flex w-full items-center rounded-md bg-muted p-1 text-muted-foreground">
      <TabsTrigger
        v-for="tab in tabs"
        :key="tab.value"
        :value="tab.value"
        :class="
          cn(
            'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--motion-fast)] ring-focus',
            'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm'
          )
        "
      >
        <component :is="tab.icon" v-if="tab.icon" class="h-3.5 w-3.5" />
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <slot />
  </TabsRoot>
</template>
