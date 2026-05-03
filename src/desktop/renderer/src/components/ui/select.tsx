import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon, ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"

type SelectLabelRegistry = {
  labels: Map<string, React.ReactNode>
  register: (value: unknown, label: React.ReactNode) => () => void
}

const SelectLabelContext = React.createContext<SelectLabelRegistry | null>(null)

function selectValueKey(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  return JSON.stringify(value) ?? String(value)
}

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const collectedLabels = React.useMemo(() => collectSelectLabels(props.children), [props.children])
  const [registeredLabels, setRegisteredLabels] = React.useState(() => new Map<string, React.ReactNode>())
  const labels = React.useMemo(() => new Map([...collectedLabels, ...registeredLabels]), [collectedLabels, registeredLabels])
  const register = React.useCallback((value: unknown, label: React.ReactNode) => {
    const key = selectValueKey(value)
    setRegisteredLabels((current) => {
      if (current.get(key) === label) {
        return current
      }
      const next = new Map(current)
      next.set(key, label)
      return next
    })
    return () => {
      setRegisteredLabels((current) => {
        if (current.get(key) !== label) {
          return current
        }
        const next = new Map(current)
        next.delete(key)
        return next
      })
    }
  }, [])
  const contextValue = React.useMemo<SelectLabelRegistry>(() => ({
    labels,
    register,
  }), [labels, register])

  return (
    <SelectLabelContext.Provider value={contextValue}>
      <SelectPrimitive.Root {...props} />
    </SelectLabelContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, children, placeholder, ...props }: SelectPrimitive.Value.Props) {
  const registry = React.useContext(SelectLabelContext)
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      placeholder={placeholder}
      {...props}
    >
      {children ?? ((value: unknown) => {
        if (value == null || value === "") {
          return placeholder
        }
        if (Array.isArray(value)) {
          return value.map((item) => registry?.labels.get(selectValueKey(item)) ?? String(item)).join(", ")
        }
        return registry?.labels.get(selectValueKey(value)) ?? String(value)
      })}
    </SelectPrimitive.Value>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-full items-center justify-between gap-1.5 rounded-[var(--control-radius)] border border-transparent bg-white px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none hover:border-[var(--slate-7)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-10 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn("relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--control-menu-radius)] bg-white text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-3 py-2.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  label,
  ...props
}: SelectPrimitive.Item.Props) {
  const registry = React.useContext(SelectLabelContext)
  const displayLabel = label ?? children
  React.useEffect(() => {
    if (!registry || props.value === undefined || !isPlainSelectLabel(displayLabel)) {
      return undefined
    }
    return registry.register(props.value, displayLabel)
  }, [displayLabel, props.value, registry])

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      label={label ?? (isPlainSelectLabel(displayLabel) ? String(displayLabel) : undefined)}
      className={cn(
        "group relative flex w-full cursor-default items-center gap-2.5 rounded-[var(--control-item-radius)] py-2 pr-8 pl-3 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex-1 min-w-0 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 hidden size-4 items-center justify-center group-data-[selected]:flex group-data-[highlighted]:group-data-[selected]:flex" />
        }
      >
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function isPlainSelectLabel(value: React.ReactNode): value is string | number {
  return typeof value === "string" || typeof value === "number"
}

function collectSelectLabels(children: React.ReactNode): Map<string, React.ReactNode> {
  const labels = new Map<string, React.ReactNode>()

  function visit(node: React.ReactNode): void {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) {
        return
      }
      const props = child.props as { value?: unknown; label?: React.ReactNode; children?: React.ReactNode }
      if (child.type === SelectItem && props.value !== undefined) {
        const label = props.label ?? props.children
        if (isPlainSelectLabel(label)) {
          labels.set(selectValueKey(props.value), label)
        }
      }
      visit(props.children)
    })
  }

  visit(children)
  return labels
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1 my-1 h-px bg-border/50",
        className
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-white py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-white py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
