/**
 * Row colours.
 *
 * The original app shipped a named palette; each entry provides a row tint and
 * a dot colour. Kept as data so the settings UI can render the picker.
 */
export const COLORS = [
  { value: 'default', label: '默认', dot: 'bg-slate-300', row: '' },
  { value: 'blue', label: '蓝色', dot: 'bg-blue-500', row: 'border-l-2 border-l-blue-500' },
  { value: 'green', label: '绿色', dot: 'bg-green-500', row: 'border-l-2 border-l-green-500' },
  { value: 'orange', label: '橙色', dot: 'bg-orange-500', row: 'border-l-2 border-l-orange-500' },
  { value: 'red', label: '红色', dot: 'bg-red-500', row: 'border-l-2 border-l-red-500' },
  { value: 'purple', label: '紫色', dot: 'bg-purple-500', row: 'border-l-2 border-l-purple-500' },
  { value: 'pink', label: '粉色', dot: 'bg-pink-500', row: 'border-l-2 border-l-pink-500' },
  { value: 'yellow', label: '黄色', dot: 'bg-yellow-500', row: 'border-l-2 border-l-yellow-500' },
]

export const COLOR_STYLES = Object.fromEntries(
  COLORS.map((c) => [c.value, { row: c.row, dot: c.dot }])
)

export function colorOf(value) {
  return COLORS.find((c) => c.value === value) ?? COLORS[0]
}

/** Sort order the app uses when "order by colour" is enabled. */
export function colorRank(value) {
  const i = COLORS.findIndex((c) => c.value === value)
  return i === -1 ? COLORS.length - 1 : i
}
